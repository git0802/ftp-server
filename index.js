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

var dataBatch = [];
const batchSize = 500;
const batchTime = 60000;

function createEarpLog(data, recordCount) {
  EarpLog(data, recordCount);
}

if (dataBatch.length >= batchSize) {
  console.log(dataBatch);
  createEarpLog(JSON.stringify(dataBatch), dataBatch.length);
  dataBatch = [];
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
server.on('client:connected', function (connection) {
  var username = null
  
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
      
      console.log('Login Success');

      success(username)
    } else {
      failure()
    }
  })

  connection.on('file:stor', function(status, transferInfo) {
    const filePath = `${process.cwd()}` + `${transferInfo.file}`;

    let cacheData = { "startTimestampUTC": '', "endTimestampUTC": "", "bytesTx": '', "disconnectReason": "", "ipAddress": '', "port": '', "fileName": '', "serialNo": ''};
    
    cacheData.startTimestampUTC = transferInfo.time;
    cacheData.ipAddress = this.socket.remoteAddress.split("::ffff:")[1];
    cacheData.port = this.socket.remotePort;
    cacheData.fileName = path.basename(filePath);
    cacheData.serialNo = path.basename(filePath).split('_')[0];

    if (status === 'open') {  
      cacheData.bytesTx = fs.statSync(filePath).size;

      dataBatch.push(cacheData);

      setInterval(() => {       
        cacheData.bytesTx = fs.statSync(filePath).size;

        dataBatch.push(cacheData);
      }, batchTime);

      console.log(`Upload Start`, cacheData);
    }

    if(status === 'error') {    
      cacheData.bytesTx = transferInfo.bytesWritten;
      cacheData.endTimestampUTC = transferInfo.eTime;
      cacheData.disconnectReason = "File Upload Errors!";

      dataBatch.push(cacheData);
      
      console.log(`Upload Error`, cacheData);
    }

    if(status === 'close') {
      cacheData.bytesTx = transferInfo.bytesWritten;      
      cacheData.startTimestampUTC = transferInfo.sTime;
      cacheData.endTimestampUTC = transferInfo.eTime;
      cacheData.disconnectReason = "File Upload end!";

      dataBatch.push(cacheData);
      
      console.log(`upload end`, cacheData);
    }
  });
    
  connection.socket.on('close', function () {
    
    console.log('Client connection closed');
  });    
});

server.debugging = 0
server.listen(options.port)
console.log('Listening on port ' + options.port)