const express = require('express');
const TaskModel = require('../model/ResModel');
const {exec} = require('child_process');
const Groq = require('groq-sdk');
const os = require('os');
const { compileFunction } = require('vm');
const fs = require('fs');
const path = require('path');

const workingDir = os.platform() === 'win32'?`${process.env.USERPROFILE}\\Desktop`:`${process.env.HOME}/Desktop`

const isGitRepo = fs.existsSync(path.join(workingDir,'.git'));

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
   const prompt = `You are a helpful assistant that converts plain English developer instructions into pure shell commands.
ONLY return the shell commands, with NO explanations, NO headings, NO markdown (like \`\`\`), and NO extra text.
Just output one command per line.

Instruction:
${plan}`;
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
// function extractshell(plan) {
//    return plan
//    .split('\n')//split the string into lines
//    .map(line=>line.trim().replace(/^\d+\.\s*/,'')) //remove leading numbers like "1. ","2. ",etc.
//    .filter(cmd=> cmd && !cmd.toLowerCase().startsWith('note'))
// }



// async function executePlan(plan) {
//    const lines = plan.split('\n');
//    const commands = [];
 
//    for (let line of lines) {
//      line = line.trim();
//      if (!line) continue;
 
     
//      const match = line.match(/(?:run\s+(?:the\s+)?command\s+)([^\n\.\!]+?)(?=\s+(to|and|in|with|for)|[\.\!]|$)/i);
//      if (match) {
//        const cmd = match[1].trim();
//        if (/^(cd|echo|mkdir|touch|rm|ls|python|node|git|npm|npx)\b/.test(cmd)) {
//          commands.push(cmd);
//          continue;
//        }
//      }
//       if (/^(cd|echo|mkdir|touch|rm|ls|python|node|git|npm|npx)\b/.test(line)) {
//        commands.push(line);
//      }
//    }
 
//    return commands;
//  }
 
 
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

function translatetoPlatformCommand(cmd) {
   if(os.platform()!== 'win32') return cmd;//no change for the unix systems
   const [baseCmd, ...args] = cmd.trim().split(/\s+/)//baseCmd will have the first word , eg.touch and the rest part in an array using the rest operator(...),splitting done by rejex expression.
   let argString = args.join(' ');//converts array into space seperated string
   argString = argString.replace(/([^"]\S*\s+\S*)/g,match=>`"${match}"`)//wrapping arguements in quotes if they contain space
   switch(baseCmd) {
      case 'touch':
         return `New-Item ${argString} -ItemType File -Force`//touch is a unix command and will not work in windows , what we do , we convert the touch command into its equivalent in windows
      case 'ls':
         return 'Get-ChildItem';  //in windows ls->Get-Children
      case 'mkdir':
         return `New-Item ${argString} -ItemType Directory -Force`;//creating a new directory
      case 'cat':
         return `Get-Content ${argString}`;//reads file and give output the content
      case 'echo':
         return `Write-Output ${argString}`;//displays a message or a string to a termminal
      case 'cd':
         return `Set-Location ${argsString}`;
      default:
         return cmd;              
   }
}

exports.executeTask = async (req, res, next) => {
   try{
      const {taskid} = req.params;
      const Task = await TaskModel.findById(taskid);
      if(!Task) {
         return res.status(404).json({error:'Task does not exist'});
      }
      if(Task.status!=='pending' && Task.status!=='exec') {
         return res.status(400).json({error:'task already executed'});
      }//task can only be executed if its either pending or exec
      Task.status = 'exec';
      await Task.save();
      //converts the task's plan "natural language instructions" into a series of shell commands
      const shellPlan = await translateToShellCommands(Task.plan);
      //split the shell commands into array of individual commands
      const commands = shellPlan.split('\n').map(cmd=>cmd.trim()).filter(Boolean)//removes any false values like empty string
      const output = [];
      //creating different paths for unix and windows systems
      
      //setting shell for the platform powershell->windows,bash->unix like systems
      const shell = os.platform() === 'win32'?'Powershell.exe':'/bin/bash'

      for(const cmd of commands) {
         if(cmd.trim() === '...' || cmd.includes('...')) {
            output.push('skipped invalid placeholder command');
            continue;
         }
         if(cmd.startsWith('git') && !isGitRepo) {
            output.push('skipped Git command:not a git repo');
            continue;
         }
         const translatecmd = translatetoPlatformCommand(cmd);
         await new Promise((resolve,reject)=>{
            exec(translatecmd,{cwd:workingDir,shell},(error,stdout,stderr)=>{
               if(error) {
                  //if error happens in execution then reject the promise
                  reject(`Error executing the commands: ${error.message}`);
               } else if(stderr) {
                  //if there any error (stderr), reject the promise with this message
                  reject(`stderr:${stderr}`);
               } else{
                  output.push(stdout);
                  resolve();//resolve the promise once command has completed successfully
               }
            });
         }).catch(err=>{
            //if promise is rejected (error or stderr),store the error message
            output.push(err);
         })
      }
      res.status(200).json({output});
      
   }catch(error) {
      res.status(500).json({error:`Failed to execute task:${error.message}`});
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