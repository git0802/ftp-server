const ftpd = require('ftpd')
const fs = require('fs')
const path = require('path')
const { isEmpty } = require('lodash');

require('dotenv').config()

const { EarpLog } = require("./models/earplogModel");
const { v4: uuidv4 } = require('uuid');

var keyFile
var certFile
var server

var cacheData = {};
var dataBatch = [];
const batchSize = 500;
const batchTime = 60000;

function createEarpLog(data, recordCount) {
  EarpLog(data, recordCount);
}

function processNewData() {
  for (const key in cacheData) {
    if (cacheData.hasOwnProperty(key)) {
      if (!isEmpty(cacheData[key].start) && !isEmpty(cacheData[key].end)) {
        if (cacheData[key].isSendStartRecord !== true)
          dataBatch.push(cacheData[key].start);
        dataBatch.push(cacheData[key].end);
        delete cacheData[key];
      } else if (!isEmpty(cacheData[key].start)) {
        if (cacheData[key].isSendStartRecord !== true) {
          dataBatch.push(cacheData[key].start);
          cacheData[key].isSendStartRecord = true;
        }
      }
    }
  }

  if (dataBatch.length >= batchSize) {
    console.log(dataBatch);
    createEarpLog(JSON.stringify(dataBatch), dataBatch.length);
    dataBatch = [];
  }
}

setInterval(() => {
  if (dataBatch.length > 0) {
    console.log(dataBatch);
    createEarpLog(JSON.stringify(dataBatch), dataBatch.length);
    dataBatch = [];
  }
}, batchTime);

// use the IP and PORT from the .env file or default to localhost:21
var options = {
  host: process.env.FTPSRV_PASV_IP || '127.0.0.1',
  port: process.env.FTPSRV_PORT || 21,
  tls: null,
}

// Check if SSL KEY / CERT are provided ELSE start without SSL support
if (process.env.KEY_FILE && process.env.CERT_FILE) {
  console.log('Running as FTPS server')
  if (process.env.KEY_FILE.charAt(0) !== '/') {
    keyFile = path.join(__dirname, process.env.KEY_FILE)
  }
  if (process.env.CERT_FILE.charAt(0) !== '/') {
    certFile = path.join(__dirname, process.env.CERT_FILE)
  }
  options.tls = {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
    ca: !process.env.CA_FILES
      ? null
      : process.env.CA_FILES.split(':').map(function (f) {
          return fs.readFileSync(f)
        }),
  }
} else {
  console.log()
  console.log('###### To run as FTPS server, #####')
  console.log('### set "KEY_FILE", "CERT_FILE" ###')
  console.log('###### or "CA_FILES" env vars. ####')
  console.log()
}

// get ftp root directory listing
server = new ftpd.FtpServer(options.host, {
  getInitialCwd: function () {
    return '/downloads'
  },
  getRoot: function () {
    return process.cwd()
  },
  pasvPortRangeStart: 1025,
  pasvPortRangeEnd: 1050,
  tlsOptions: options.tls,
  allowUnauthorizedTls: true,
  useWriteFile: false,
  useReadFile: false,
  uploadMaxSlurpSize: 7000, // N/A unless 'useWriteFile' is true.
  allowedCommands: [
    'XMKD',
    'AUTH',
    'TLS',
    'SSL',
    'USER',
    'PASS',
    'PWD',
    'OPTS',
    'TYPE',
    'PORT',
    'PASV',
    'APPE',
    'LIST',
    'CWD',
    'MKD',
    'SIZE',
    'STOR',
    'MDTM',
    'DELE',
    'QUIT',
  ],
})

server.on('error', function (error) {
  console.log('FTP Server error:', error)
})

// verify user and password from .env file
server.on('client:connected', function (connection, error, close) {
  var username = null
  const id = uuidv4();

  let ipAddress = connection.socket.remoteAddress.split("::ffff:")[1];
  let port = connection.socket.remotePort;

  let startTimestamp = new Date();

  connection.on('command:user', function (user, success, failure) {
    if (process.env.DEVICE_USERNAME === user) {
      username = user
      success()
    } else {
      
      if (isEmpty(cacheData[id]))
        cacheData[id] = { start: {}, end: {} };

      cacheData[id].start = { "startTimestampUTC": `${startTimestamp.toISOString()}`, "endTimestampUTC": `${new Date().toISOString()}`, "bytesTx": 0, "disconnectReason": "Bad Username!", "ipAddress": `${ipAddress}`, "port": `${port}`, "fileName": "", "serialNo": "" };
      processNewData();
      failure()
    }
  })

  connection.on('command:pass', function (pass, success, failure) {

    if (process.env.PWD && process.env.DEVICE_PASSWORD === pass) {
      
      if (isEmpty(cacheData[id]))
        cacheData[id] = { start: {}, end: {} };

      cacheData[id].start = { "startTimestampUTC": `${startTimestamp.toISOString()}`, "endTimestampUTC": "", "bytesTx": 0, "disconnectReason": "", "ipAddress": `${ipAddress}`, "port": `${port}`, "fileName": "", "serialNo": "" };
      processNewData();

      success(username)
    } else {
      
      if (isEmpty(cacheData[id]))
        cacheData[id] = { start: {}, end: {} };
      
      cacheData[id].start = { "startTimestampUTC": `${startTimestamp.toISOString()}`, "endTimestampUTC": `${new Date().toISOString()}`, "bytesTx": 0, "disconnectReason": "Password Incorrect!", "ipAddress": `${ipAddress}`, "port": `${port}`, "fileName": "", "serialNo": "" };
      processNewData();
      failure()
    }
  })

  connection.on('file:stor', function(status, transferInfo) {
    let fileName;
    let serialNo;
    let bytesTx = 0;

    const filePath = `${process.cwd()}` + `${transferInfo.file}`;

    if (status === 'open') {
      fileName = path.basename(filePath);
      serialNo = fileName.split('_')[0];
      bytesTx = fs.statSync(filePath).size;;
      console.log(`${fileName} ${serialNo} ${bytesTx} Upload start`);

      if (isEmpty(cacheData[id]?.start))
        return;

      if (isEmpty(cacheData[id].end))
        cacheData[id].end = { ...cacheData[id].start };

      cacheData[id].end = { ...cacheData[id].start, fileName, serialNo, bytesTx };
      cacheData[id].end.endTimestampUTC = new Date().toISOString();
    }

    if(status === 'error') {
      console.log('File Upload Errors!');

      fileName = path.basename(filePath);
      serialNo = fileName.split('_')[0];
      bytesTx = fs.statSync(filePath).size;;
      
      if (isEmpty(cacheData[id]?.start))
        return;

      if (isEmpty(cacheData[id].end))
        cacheData[id].end = { ...cacheData[id].start };

      cacheData[id].end = { ...cacheData[id].start, fileName, serialNo, bytesTx };
      cacheData[id].end.endTimestampUTC = new Date().toISOString();
      cacheData[id].end.disconnectReason = "File Upload Errors!";
    }

    if(status === 'close') {
      fileName = path.basename(filePath);
      serialNo = fileName.split('_')[0];
      bytesTx = fs.statSync(filePath).size;;
      console.log(`${fileName} ${serialNo} ${bytesTx} upload end`);

      if (isEmpty(cacheData[id]))
        cacheData[id] = { start: {}, end: {} };

      cacheData[id].end = { ...cacheData[id].start, fileName, serialNo, bytesTx };
      cacheData[id].end.endTimestampUTC = new Date().toISOString();
      cacheData[id].end.disconnectReason = "File Upload end!";
    }

    });
    
    connection.socket.on('close', function () {
      if (isEmpty(cacheData[id]?.start))
        return;

      if (isEmpty(cacheData[id].end))
        cacheData[id].end = { ...cacheData[id].start };

      cacheData[id].end.endTimestampUTC = new Date().toISOString();
      cacheData[id].end.disconnectReason = "Client connection closed.";
    });
    
});

server.debugging = 4
server.listen(options.port)
console.log('Listening on port ' + options.port)