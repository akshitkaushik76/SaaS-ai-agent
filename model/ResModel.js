const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
    taskDesc: {
        type: String,
        required: true,
        trim: true
    },
    plan: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'exec', 'completed', 'failed'],
        default: 'pending'
    },
    feedBack: {
        type: String,
        default: ''
    },
    retryCount: {
        type: Number,
        default: 0
    },
    content:{
        type:String
    },
    shellCommands: {
        type: String,
        default: ''
    },
    output: {
        type: String,
        default: ''
    },
    error: {
        type: String,
        default: ''
    }
    
}, {
    timestamps: true  // To automatically track createdAt and updatedAt fields
});

const TaskModel = mongoose.model('Task', taskSchema);

module.exports = TaskModel;
