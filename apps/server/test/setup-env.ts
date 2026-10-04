import { TEST_DATABASE_URL } from './test-database';

process.env.DATABASE_URL = TEST_DATABASE_URL;

// 头像落盘到临时目录，避免污染开发用的 uploads/
process.env.UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'skill-hub-e2e-uploads');
process.env.PRIVATE_UPLOAD_DIR = require('node:path').join(require('node:os').tmpdir(), 'skill-hub-e2e-private-uploads');

// Node 19+ 全局 Agent 默认 keep-alive；测试中关闭，每个请求用新连接，避免复用到服务端已关闭的空闲连接。
const http = require('node:http');
http.globalAgent = new http.Agent({ keepAlive: false });
