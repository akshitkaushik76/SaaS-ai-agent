const { application } = require('express');
const task = require('../model/ResModbl');
const {exec} = require('child_process');

async function CreatePlan(prompt,feedback) {//takes two parameter
   const apiKey = process.env.api_key;
   const fullPrompt  = feedback?`Retry task with the feedback\n\nOriginal task:${prompt}`:`Create a step-by-step plan to:${prompt}`;
   const response = await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:POST,
      headers:{
         'Authorization':`Bearer ${apiKey}`,
         'Content-Type':application/json
      },
      body:JSON.stringify({
         model:'llama3-8b-8192',
         messages:[
            {//defining the system role and behavior
               role:'system',content:'You are an assistant that help create task execution plans.'
            },
            {
               role:'user',content:fullPrompt
            },
         ],
      }),
   });
   const data = await response.json();
   return data.choices[0].message.content.trim();
} 
function extractshell(plan) {
   return plan
   .split('\n')//split the string into lines
   .map(line=>line.trim().replace(/^\d+\.\s*/,'')) //remove leading numbers like "1. ","2. ",etc.
   .filter(cmd=> cmd && !cmd.toLowerCase().startsWith('note'))// keep non-empty lines that 
}
async function executePlan(plan) {
   const commands = extractshell(plan);//helper function parses text and returns only executables command lines as an array
   let output = '';
   for(const command of commands) {
      const result = await new Promise((resolve,reject)=>{//helps to run shell commands syncronously inside the loop, we use promise to make it awaitable.
           exec(command,{cwd:process.cwd()},(error,stdout,stderr)=>{//{cwd:process.cwd()} sets the current working directory(cwd) where nodejs process was started
            if(error) reject(stderr || error.message);
            else resolve(stdout);
           })                                               //exec() function nodejs childprocess method is callback based,notpromise based
      })
      output+=`\n$ ${command}\n${result}`;
   }
   return output;

}
exports.createTask = async (req,res)=>{
   try{
      const {taskdesc,feedBack} = req.body;
      if(!taskdesc) {
         return res.status(400).json({error:'task description is required'})
      }
      const plan = await CreatePlan(taskdesc,feedBack);
      const task = new task({
         taskdesc,
         plan,
         status:'pending',
         feedBack:feedBack || undefined,
         retryCount:feedBack?1:0,
      });
      await task.save();
      res.status(201).json({taskId:task._id,plan});
   } catch(error) {
      res.status(500).json({error:`Failed to create task:${error.message}`});
   }
   
};
exports.executeTask = async (req,res,next)=>{
   try{
      const {taskid} = req.params;
      const Task = await task.findById(taskid);
      if(!Task) {
         return res.status(404).json({error:'Task not found'});
      }
      if(Task.status!=='pending') {
         return res.status(400).json({error:'Task already executed'});
      }
      const output = await executePlan(Task.plan);
      task.status = 'completed';
      await task.save();
      res.status(200).json({taskid,output});
} catch(error) {
   const Task = await task.findById(req.params.taskid);
   if(Task) {
      task.status = 'Failed';
      await task.save();
   } 
   res.status(500).json({error:`Failed to fetch task:${error.message}`});
}
};
exports.getTask = async(req,res,next)=>{
   try{
      const {taskid} = req.params;
      const Task = await Task.findById(taskid);
      if(!Task) {
         return res.status(404).json({error:'task not found'});
      } 
      res.json(task);
   } catch(error) {
      res.status(500).json({error:`Failed to fetch task:${error.message}`});
   }
}