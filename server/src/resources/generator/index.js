const Router = require('koa-router');
const controller = require('./generator.controller');

const router = new Router();

router.post('/pdf', controller.generatePdf);
router.post('/image', controller.generateImage);

module.exports = router.routes();
