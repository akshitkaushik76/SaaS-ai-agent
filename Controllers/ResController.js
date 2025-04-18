const { application } = require('express');
const TaskModel = require('../model/ResModel');
const {exec} = require('child_process');
const Groq = require('groq-sdk');
const groq = new Groq({
   apiKey:process.env.GROQ_API_KEY
})
async function CreatePlan(prompt,feedback) {//takes two parameter
   const fullprompt  = feedback?`Retry task with the feedback\n\nOriginal task:${prompt}`:`Create a step-by-step to plan to:${prompt}`;
   try{
      const response = await groq.chat.completions.create({
         model: 'llama3-8b-8192',
         messages:[
            {role:'system',content:'You are an assistant that helps create task execution plans.'},
            {role:'user',content:fullprompt}
         ]
      });
      const plan = response.choices[0].message.content.trim();
      return plan;
   }catch(error) {
      console.error('Groq plan generation failed',error);
      throw new Error('Failed to generate plan from groq');
   }
} 
async function translateToShellCommands(plan) {
   const prompt = `You are a helpful assistant that converts plain language developer instructions into shell commands.
   Instruction:
   ${plan}
   respond ONLY in shell commands , one per line.do NOT add explaination.`;
   try{
      const response = await groq.chat.completions.create({
         model:'llama3-8b-8192',
         messages:[{role:'user',content:prompt}],
         temperature:0//returns most likely answer
      });
      const commands = response.choices[0].message.content.trim();
      return commands;
   }
   catch(error) {
      console.log('groq translation failed',error);
      throw new Error('failed to translate task');
   }
}
function extractshell(plan) {
   return plan
   .split('\n')//split the string into lines
   .map(line=>line.trim().replace(/^\d+\.\s*/,'')) //remove leading numbers like "1. ","2. ",etc.
   .filter(cmd=> cmd && !cmd.toLowerCase().startsWith('note'))// keep non-empty lines that 
}
async function executePlan(plan) {
   const lines = plan.split('\n');
   const commands = [];
 
   for (let line of lines) {
     line = line.trim();
     if (!line) continue;
 
     // Match embedded shell commands like "Run the command mkdir xyz to create..."
     const match = line.match(/(?:run\s+(?:the\s+)?command\s+)([^\n\.\!]+?)(?=\s+(to|and|in|with|for)|[\.\!]|$)/i);
     if (match) {
       const cmd = match[1].trim();
       if (/^(cd|echo|mkdir|touch|rm|ls|python|node|git|npm|npx)\b/.test(cmd)) {
         commands.push(cmd);
         continue;
       }
     }
 
     // Match raw command lines
     if (/^(cd|echo|mkdir|touch|rm|ls|python|node|git|npm|npx)\b/.test(line)) {
       commands.push(line);
     }
   }
 
   return commands;
 }
 
 
exports.createTask = async (req,res)=>{
   try{
      const {taskDesc,feedBack} = req.body;
      if(!taskDesc) {
         return res.status(400).json({error:'task description is required'})
      }
      const plan = await CreatePlan(taskDesc,feedBack);
      const task = new TaskModel({
         taskDesc,
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
exports.executeTask = async (req, res, next) => {
   try{
      const {taskid} = req.params;
      const Task = await TaskModel.findById(taskid);
      if(!Task) {
         return res.status(404).json({error:'Task not found'});
      }
      if(Task.status!=='pending' && Task.status!=='exec') {
         return res.status(400).json({error:'task already executed'});
      }
      Task.status = 'exec';
      await Task.save();
      const shellPlan = await translateToShellCommands(Task.plan);
      const commands = shellPlan.split('\n');
      const output = [];
      for(const cmd of commands) {
         if(!cmd.trim()) continue;
         await new Promise((resolve,reject)=>{
            exec(cmd,{cwd:process.env.USERPROFILE+'\\Desktop',shell:'cmd.exe'},(error,stdout,stderr)=>{
               if(error) {
                  reject(`Error executing the command:${error.message}`);
               } else if(stderr) {
                  reject(`stderr:${stderr}`);
               } else{
                  output.push(stdout);
                  resolve();
               }
            });
         }).catch((err)=>{
            output.push(err);
         });
      }
      Task.status = 'completed'
      await Task.save();
      res.status(200).json({taskid,output});
   } catch(error) {
      console.error("Error during task execution:",error);
      try{
         const Task = await TaskModel.findById(req.params.taskid);
         if(Task) {
            Task.status = 'failed';
            await Task.save();
         }
      } catch(updateError) {
         console.error("Failed to update task status",updateError);
      }
      res.status(500).json({
         error:`Failed to fetch task:${error?.message || error}`
      });
   }
};
 
 
exports.getTask = async(req,res,next)=>{
   try{
      const {taskid} = req.params;
      const Task = await TaskModel.findById(taskid);
      if(!Task) {
         return res.status(404).json({error:'task not found'});
      } 
      res.json(task);
   } catch(error) {
      res.status(500).json({error:`Failed to fetch task:${error.message}`});
   }
}