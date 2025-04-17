const express = require('express');
const mongoose = require('mongoose');
const app = express();
app.use(express.json());
const PORT = 9012;
mongoose.connect('mongodb://localhost:27017/SaaS-ai-agent',{
    useNewUrlParser:true,
    useUnifiedTopology:true
}).then((conn)=>{
   console.log("database connected successfully");
}).catch((error)=>{
    console.log("unsuccessful connection"); 
})
app.listen(PORT,console.log('server running at: ',PORT));