'use strict';

const serve = require('koa-static');
const Koa = require('koa');

const app = new Koa();

app.use(serve(__dirname + '/www/'));

app.listen(process.env.PORT || 3000);
