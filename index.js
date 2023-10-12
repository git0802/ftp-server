const ftpd = require('ftpd')
const fs = require('fs')
const path = require('path')
const { isEmpty } = require('lodash');

require('dotenv').config()

const { EarpLog } = require("./models/earplogModel");
const uuid = require('uuid');

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

  let ipAddress = connection.socket.remoteAddress.split("::ffff:")[1];
  let port = connection.socket.remotePort;

  let id = `${ipAddress}:${port}:${uuid.v4()}`;

  let startTimestamp = new Date();

  connection.on('command:user', function (user, success, failure) {
    if (process.env.DEVICE_USERNAME === user) {
      username = user
      success()
    } else {
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
      failure()
    }
  })

  connection.on('file:stor', function(status, transferInfo) {
    const filePath = `${process.cwd()}` + `${transferInfo.file}`;
    
    let fileName = path.basename(filePath);
    let serialNo = fileName.split('_')[0];

    cacheData[id].store = { fileName, serialNo, filePath };

    if (status === 'open') {    
      cacheData[id].store.bytesTx = fs.statSync(filePath).size;

      console.log(`${fileName} ${serialNo} ${cacheData[id].store.bytesTx} Upload Start`);
    }

    if(status === 'error') {    
      cacheData[id].store.bytesTx = fs.statSync(filePath).size;
      cacheData[id].store.endTimestampUTC = new Date().toISOString();
      cacheData[id].store.disconnectReason = "File Upload Errors!";
      
      console.log(`${fileName} ${serialNo} ${cacheData[id].store.bytesTx} Upload Error`);
    }

    if(status === 'close') {
      cacheData[id].store.bytesTx = fs.statSync(filePath).size;
      cacheData[id].store.endTimestampUTC = new Date().toISOString();
      cacheData[id].store.disconnectReason = "File Upload end!";
      
      console.log(`${fileName} ${serialNo} ${cacheData[id].store.bytesTx} upload end`);
    }

    });
    
    connection.socket.on('close', function () {
      if (isEmpty(cacheData[id]?.start))
        return;

      if (isEmpty(cacheData[id]?.store))
        return;

      if (isEmpty(cacheData[id].end))
        cacheData[id].end = { ...cacheData[id].start };

      if (isEmpty(cacheData[id].store.endTimestampUTC)) {
        cacheData[id].end.endTimestampUTC = new Date().toISOString();
        cacheData[id].end.disconnectReason = "Client connection closed.";
      } else {
        cacheData[id].end.endTimestampUTC = cacheData[id].store.endTimestampUTC;
        cacheData[id].end.disconnectReason = cacheData[id].store.disconnectReason;
      }

      if (cacheData[id].store.bytesTx === 0) {
        cacheData[id].end.bytesTx = fs.statSync(cacheData[id].store.filePath).size;
      } else {
        cacheData[id].end.bytesTx = cacheData[id].store.bytesTx
      }

      cacheData[id].end.fileName = cacheData[id].store.fileName;
      cacheData[id].end.serialNo = cacheData[id].store.serialNo;

      console.log(`${cacheData[id].end.fileName} ${cacheData[id].end.serialNo} ${cacheData[id].end.bytesTx} ${cacheData[id].end.endTimestampUTC} ${cacheData[id].end.disconnectReason}`);
    });
    
});

server.debugging = 4
server.listen(options.port)
console.log('Listening on port ' + options.port)