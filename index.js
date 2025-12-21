const { MongoClient, ServerApiVersion } = require('mongodb');
const express = require('express');
const cors = require ('cors');
require('dotenv').config();
const port= process.env.PORT || 5000 ;

const app = express();
app.use(cors());
app.use(express.json());

const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const verifyFBToken = async (req, res, next)=>{
  const token = req.headers.authorization;
  console.log("Token received on backend:", token);

  if(!token){
    return res.status(401).send({message: 'unauthorize access'})
  }

  try{
    const idToken= token.split(' ')[1]
    const decoded = await admin.auth().verifyIdToken(idToken)
    console.log("decoded info", decoded)
    req.decoded_email = decoded.email;
    next();
  }
  catch(error){
    console.log("Firebase Error:", error.message);
    return res.status(401).send({message: 'unauthorize access'})
  }
}



const uri = "mongodb+srv://backend11:VOA8iQxWQP8lYYB7@cluster0.o6mocqo.mongodb.net/?appName=Cluster0";

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection

    const database = client.db('bloodDonationDB')
    const usersCollection = database.collection('users');
    const requestCollection = database.collection('request');

    app.post('/users', async(req, res)=>{
      const userInfo = req.body;
      userInfo.createdAt = new Date();
      userInfo.role = 'donor'
      userInfo.status = 'active';
      const result = await usersCollection.insertOne(userInfo);
      if (!result) return res.status(404).send({ message: "User not found" });
      res.send(result)
    });


    app.get('/users', verifyFBToken, async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
});

    app.get(('/users/role/:email'),async(req,res)=>{
      const {email} = req.params
      const query = {email:email}
      const result = await usersCollection.findOne(query)
      res.send(result)
    })

    app.get('/users/:email', async(req,res)=>{
      const email = req.params.email
      const query = {email:email}
      const result = await usersCollection.findOne(query);
      res.send(result)
    })

    app.patch('/update/user/status', verifyFBToken, async(req,res)=>{
      const {email, status} = req.query;
      const query = {email:email};

      const updateStatus = {
        $set:{
          status: status
        }
      }
      const result = await usersCollection.updateOne(query, updateStatus)
      res.send(result)
    })

    app.post('/requests',verifyFBToken,async(req, res)=>{
      const data = req.body;
      data.createdAt = new Date();
      const result = await requestCollection.insertOne(data);
      res.send(result)
    })

    app.get('/volunteer/requests/:email', async(req,res)=>{
      const email= req.params.email;
      const query ={VolunteerEmail:email};

      const result = await requestCollection.find(query).toArray();
      res.send(result)
    })

    app.get('/all-donation-requests',verifyFBToken, async(req,res)=>{
      const result = await requestCollection.find().toArray();
      res.send(result);
    })

    app.delete('/all-donation-requests/:email', async(req,res)=>{
      const email = req.params.email;
      const query = {requesterEmail:email};
      const result = await requestCollection.deleteOne(query)
      res.send(result)
    })

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


app.get('/', (req,res)=>{
    res.send('hallo world')
})

app.listen(port,()=>{
    console.log(`server is running on ${port}`)
})