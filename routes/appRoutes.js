const express = require('express');
const controllers = require('./../Controllers/ResController');
const router = express.Router();
router.route('/create').post(controllers.createTask);
router.route('/execute/:taskid').post(controllers.executeTask);
router.route('/getTask').get(controllers.getTask);
