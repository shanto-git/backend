const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 5000;
const stripe = require("stripe")(process.env.STRIPE_SECRATE);
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  console.log("Token received on backend:", token);

  if (!token) {
    return res.status(401).send({ message: "unauthorize access" });
  }

  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    console.log("decoded info", decoded);
    req.decoded_email = decoded.email;
    next();
  } catch (error) {
    console.log("Firebase Error:", error.message);
    return res.status(401).send({ message: "unauthorize access" });
  }
};

const uri =
  "mongodb+srv://backend11:VOA8iQxWQP8lYYB7@cluster0.o6mocqo.mongodb.net/?appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection

    const database = client.db("bloodDonationDB");
    const usersCollection = database.collection("users");
    const requestCollection = database.collection("request");
    const paymentCollection = database.collection("payment");

    app.post("/users", async (req, res) => {
      const userInfo = req.body;
      userInfo.createdAt = new Date();
      userInfo.role = "donor";
      userInfo.status = "active";
      const result = await usersCollection.insertOne(userInfo);
      if (!result) return res.status(404).send({ message: "User not found" });
      res.send(result);
    });

    app.get("/users", verifyFBToken, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const { email } = req.params;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    app.patch("/update/user/status", verifyFBToken, async (req, res) => {
      const { email, status } = req.query;
      const query = { email: email };

      const updateStatus = {
        $set: {
          status: status,
        },
      };
      const result = await usersCollection.updateOne(query, updateStatus);
      res.send(result);
    });

    app.post("/requests", verifyFBToken, async (req, res) => {
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestCollection.insertOne(data);
      res.send(result);
    });

    app.get("/my-requests/:email", async (req, res) => {
      const email = req.params.email;
      const query = { requesterEmail: email };

      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/pending-requests", async (req, res) => {
      const query = { status: "pending" };
      const result = await requestCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/donation-request/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestCollection.findOne(query);
      res.send(result);
    });

    app.patch("/donation-request/donate/:id", async (req, res) => {
      const id = req.params.id;
      const donorInfo = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          status: "inprogress",
          requesterName: donorInfo.name,
          requesterEmail: donorInfo.email,
        },
      };
      const result = await requestCollection.updateOne(filter, updatedDoc);
      console.log(result);
      res.send(result);
    });

    app.get("/all-donation-requests", verifyFBToken, async (req, res) => {
      const result = await requestCollection.find().toArray();
      res.send(result);
    });

    app.delete("/all-donation-requests/:id", async (req, res) => {
      const email = req.params.email;
      const query = { requesterEmail: email };
      const result = await requestCollection.deleteOne(query);
      res.send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send(user);
    });

    app.put("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updatedUser = req.body;

      const updateDoc = {
        $set: {
          name: updatedUser.name,
          bloodGroup: updatedUser.bloodGroup,
          district: updatedUser.district,
          upazila: updatedUser.upazila,
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.post("/create-payment-checkout", async (req, res) => {
      const information = req.body;
      const amount = parseInt(information.donateAmount) * 100;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amount,
              product_data: {
                name: "please donate",
              },
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        metadata: {
          donorName: information?.donorName,
        },
        customer_email: information.donorEmail,
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { session_id } = req.query;
      const session = await stripe.checkout.sessions.retrieve(session_id);
      const transactionId = session.payment_intent;

      const isPaymentExist = await paymentCollection.findOne({ transactionId });
      if (isPaymentExist) {
        return;
      }

      if (session.payment_status == "paid") {
        const paymentInfo = {
          amount: session.amount_total / 100,
          currency: session.currency,
          donorEmail: session.customer_email,
          userName: session.customer_details?.name,
          transactionId,
          payment_status: session.payment_status,
          paidAt: new Date(),
        };

        const result = await paymentCollection.insertOne(paymentInfo);
        return res.send(result);
      }
    });

    app.get("/all-payments", async (req, res) => {
      const result = await paymentCollection
        .find()
        .sort({ paidAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/total-funding", async (req, res) => {
      const payments = await paymentCollection.find().toArray();
      const total = payments.reduce(
        (sum, payment) => sum + (payment.amount || 0),
        0
      );
      const totalFunding = payments.length;

      res.send({
        total,
        totalFunding,
      });
    });

    app.get('/search', async (req, res) => {
    const { bloodGroup, district, upazila } = req.query;

    let query = {};

    if (bloodGroup) query.bloodGroup = bloodGroup;
    if (district) query.district = district;
    if (upazila) query.upazila = upazila;

    const result = await userCollection.find(query).toArray();
    res.send(result);
});

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("hallo world");
});

app.listen(port, () => {
  console.log(`server is running on ${port}`);
});
