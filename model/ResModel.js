const mongoose = require('mongoose');
const TaskSchema = new mongoose.Schema({
    taskDesc:{
        type:String,
        required:true,
        trim:true
    },
    plan:{
        type:String,
        required:true,
        trim:true,
    },
    status:{
        type:String,
        enum:['pending','completed','failed','exec'],
        default:'pending'
    },
    feedBack:{
        type:String,
        trim:true,
    },
    retryCount:{
        type:Number,
        default:0
    },
    createdAt:{
        type:Date,
        default:Date.now()
    }
})
const task = mongoose.model('task',TaskSchema);
module.exports = task;