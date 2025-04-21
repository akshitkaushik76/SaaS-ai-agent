const TaskModel = require('../model/ResModel');
const { exec } = require('child_process');
const util = require('util');
const Groq = require('groq-sdk');
const os = require('os');
const fs = require('fs');
const path = require('path');

const execAsync = util.promisify(exec);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const workingDir = os.platform() === 'win32'
  ? `${process.env.USERPROFILE}\\Desktop`
  : `${process.env.HOME}/Desktop`;

const isGitRepo = fs.existsSync(path.join(workingDir, '.git'));

//  1. Create Task: Generates plan + content and saves the task
const getExtensionFromTask = (taskDesc) => {
   const lower = taskDesc.toLowerCase();
   if (lower.includes('python')) return 'py';
   if (lower.includes('c++') || lower.includes('cpp')) return 'cpp';
   if (lower.includes('html')) return 'html';
   if (lower.includes('css')) return 'css';
   if (lower.includes('javascript') || lower.includes('js') || lower.includes('node')) return 'js';
   return 'txt';
 };
 
 const createTask = async (req, res) => {
   const { taskDesc, feedBack } = req.body;
   if (!taskDesc) return res.status(400).json({ error: 'taskDesc is required' });
 
   try {
     const isCodeTask = /code|algorithm|function|programming|script/.test(taskDesc.toLowerCase());
 
     const planPrompt = feedBack
       ? `Retry task with the feedback:\n\nOriginal task: ${taskDesc}\nFeedback: ${feedBack}\n\nCreate a step-by-step plan.`
       : `Create a step-by-step plan to: ${taskDesc}.`;
 
     const contentPrompt = isCodeTask
       ? `Generate only the code for the following task. Do not provide explanations or details, just the code. Topic:\n\n${taskDesc}`
       : `Generate detailed information about the following topic. If it's asking for code, provide an explanation of the algorithm. Topic:\n\n${taskDesc}`;
 
     const planResponse = await groq.chat.completions.create({
       model: 'llama3-8b-8192',
       messages: [
         { role: 'system', content: 'You are an assistant that helps create task execution plans.' },
         { role: 'user', content: planPrompt },
       ],
     });
 
     const planText = planResponse.choices[0].message.content.trim();
 
     const contentResponse = await groq.chat.completions.create({
       model: 'llama3-8b-8192',
       messages: [
         { role: 'system', content: 'You provide helpful and accurate technical content.' },
         { role: 'user', content: contentPrompt },
       ],
     });
 
     const contentText = contentResponse.choices[0].message.content.trim();
 
     if (!contentText) {
       return res.status(400).json({ error: 'Failed to generate content for the task.' });
     }
 
     const extension = getExtensionFromTask(taskDesc);
     const fileName = `${taskDesc.replace(/\s+/g, '_').toLowerCase()}.${extension}`;
     const outputDir = path.resolve(__dirname, '..', 'tasks');
 
     if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
 
     const filePath = path.join(outputDir, fileName);
     fs.writeFileSync(filePath, contentText);
 
     // Detect platform for proper shell command generation
     const isWindows = os.platform() === 'win32';
     const shellCommands = isWindows
       ? `powershell -Command "notepad ${fileName}"`
       : `code ${fileName}`;
 
     const newTask = await TaskModel.create({
       taskDesc,
       plan: planText,
       content: contentText,
       feedBack,
     });
 
     res.status(201).json({
       message: 'Task created successfully',
       taskId: newTask._id,
       task: newTask,
       filePath,
       shellCommands,
     });
   } catch (error) {
     console.error('Create task error:', error);
     res.status(500).json({ error: 'Failed to create task' });
   }
 };

//  2. Execute Task: Converts to OS shell commands and runs them
const executeTask = async (req, res) => {
   const { taskid } = req.params;
 
   try {
     const task = await TaskModel.findById(taskid);
     if (!task) return res.status(404).json({ error: 'Task not found' });
 
     // 🧠 Determine language based on task description
     let language = task.language;
     if (task.taskDesc.toLowerCase().includes('text file')) {
       language = 'text';
     } else {
       //  Ask AI to detect the programming language
       const detectLangPrompt = `What is the programming language used in this task? Just respond with the language name (e.g., JavaScript, Python, C++, etc). Task:\n\n"${task.taskDesc}"`;
 
       const langResponse = await groq.chat.completions.create({
         model: 'llama3-8b-8192',
         messages: [
           { role: 'system', content: 'Only respond with the name of the programming language.' },
           { role: 'user', content: detectLangPrompt },
         ],
       });
 
       language = langResponse.choices[0].message.content.trim();
     }
 
     // 🌍 Determine file extension dynamically
     const extension = getFileExtension(language.toLowerCase());
     const fileName = `task.${extension}`;
     const filePath = path.join(workingDir, fileName);
 
     //  Ask AI to generate code or text
     const codePrompt = language === 'text'
       ? `Write the plain text content for the following task:\n\n"${task.taskDesc}"`
       : `Write the ${language} code for the following task:\n\n"${task.taskDesc}"`;
 
     const codeResponse = await groq.chat.completions.create({
       model: 'llama3-8b-8192',
       messages: [
         {
           role: 'system',
           content: language === 'text'
             ? 'Only return plain text without any code formatting or explanation.'
             : `Return only valid ${language} code without any explanation.`
         },
         { role: 'user', content: codePrompt },
       ],
     });
 
     const taskCode = codeResponse.choices[0].message.content.trim();
 
     // 🛠 Create shell command to write content to the correct file
     const writeCommand = os.platform() === 'win32'
       ? `echo ${JSON.stringify(taskCode)} > ${fileName}`
       : `echo "${escapeDoubleQuotes(taskCode)}" > ${fileName}`;
 
     let stdout = '', stderr = '';
     try {
       const result = await execAsync(writeCommand, { cwd: workingDir });
       stdout = result.stdout;
       stderr = result.stderr;
     } catch (execErr) {
       stderr = execErr.stderr || execErr.message;
     }
 
     //  Save to DB
     task.language = language;
     task.code = taskCode;
     task.shellCommands = writeCommand;
     task.output = stdout.trim();
     task.error = stderr.trim();
     task.status = stderr ? 'failed' : 'completed';
     task.generatedFilePath = filePath;
     await task.save();
 
     //  Response
     res.status(200).json({
       message: stderr ? 'Executed with errors' : 'Executed successfully',
       language,
       shellCommands: writeCommand,
       output: stdout.trim(),
       error: stderr.trim(),
       status: task.status,
       filePath,
     });
   } catch (error) {
     console.error('Execute error:', error);
     res.status(500).json({ error: 'Failed to execute task' });
   }
 };
 
 //  Map language to file extension
 const getFileExtension = (language) => {
   const map = {
     javascript: 'js',
     typescript: 'ts',
     python: 'py',
     java: 'java',
     c: 'c',
     'c++': 'cpp',
     ruby: 'rb',
     go: 'go',
     php: 'php',
     rust: 'rs',
     shell: 'sh',
     bash: 'sh',
     powershell: 'ps1',
     text: 'txt',
     'plain text': 'txt',
     plaintext: 'txt',
   };
   return map[language] || 'txt';
 };
 
 //  Escape quotes for Linux
 const escapeDoubleQuotes = (code) => code.replace(/"/g, '\\"');
 
 const getTask = async(req,res,next)=>{
   const { taskid } = req.params;

  try {
    const task = await TaskModel.findById(taskid);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.status(200).json({
      message: 'Task retrieved successfully',
      task
    });
  } catch (error) {
    console.error('Error fetching task:', error);
    res.status(500).json({ error: 'Failed to retrieve task' });
  }
};
 
 


module.exports = {
  createTask,
  executeTask,
  getTask,
};
