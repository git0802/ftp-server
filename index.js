require("dotenv").config();

const FtpSrv = require("ftp-srv");
const { networkInterfaces } = require('os');
const { Netmask } = require('netmask');
const path = require('path');
const fs = require('fs');
const { isEmpty } = require('lodash');

const { EarpLog } = require("./models/earplogModel");

const hostname = '0.0.0.0';

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

function checkUser(username, password) {
  if (process.env.DEVICE_USERNAME === username && process.env.DEVICE_PASSWORD === password) {
    return true;
  }
  return false;
}

const nets = networkInterfaces();
function getNetworks() {
  let networks = {};
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        networks[net.address + "/24"] = net.address
      }
    }
  }
  return networks;
}

const resolverFunction = (address) => {
  const networks = getNetworks();
  for (const network in networks) {
    if (new Netmask(network).contains(address)) {
      return networks[network];
    }
  }
  return "127.0.0.1";
}
// 
const ftpServer = new FtpSrv({
  url: 'ftp://' + hostname + ':' + process.env.FTPSRV_PORT,
  pasv_url: resolverFunction,
  pasv_min: 5052,
  pasv_max: 5053,
  file_format: 'ls',
  anonymous: false,
  greeting: ["Hello user"],
  blacklist: ["DELE", "RNTO", "RETR"],
});

ftpServer.on(
  "login",
  ({ connection, username, password }, resolve, reject) => {
    const id = connection?.log?.fields?.id;
    const Peer = connection.commandSocket._peername;

    connection.on("STOR", (error, filePath) => {
      let fileName;
      let serialNo;
      let bytesTx = 0;

      console.log("store", id);
      if (error) {
        console.error(error);
        return;
      }
      fileName = path.basename(filePath);
      serialNo = fileName.split('_')[0];
      bytesTx = fs.statSync(filePath).size;


      if (isEmpty(cacheData[id]))
        cacheData[id] = { start: {}, end: {} };

      cacheData[id].end = { ...cacheData[id].start, fileName, serialNo, bytesTx };
      cacheData[id].end.endTimestampUTC = new Date().toISOString();
      connection.close();
    });

    if (checkUser(username, password)) {
      console.log("login success", id);

      if (isEmpty(cacheData[id]))
        cacheData[id] = { start: {}, end: {} };

      cacheData[id].start = { "startTimestampUTC": `${new Date().toISOString()}`, "endTimestampUTC": "", "bytesTx": 0, "disconnectReason": "", "ipAddress": `${Peer.address}`, "port": `${Peer.port}`, "fileName": "", "serialNo": "" };
      processNewData();

      return resolve({
        root: `${process.cwd()}/downloads/`
      });

    } else {
      console.log("login failed");
      cacheData[id].start = { "startTimestampUTC": `${startTimestamp.toISOString()}`, "endTimestampUTC": `${new Date().toISOString()}`, "bytesTx": 0, "disconnectReason": "Bad username or password", "ipAddress": `${Peer.address}`, "port": `${Peer.port}`, "fileName": "", "serialNo": "" };

      processNewData();
      return reject("Bad username or password");
    }
  }
);

ftpServer.on("disconnect", ({ id }) => {
  console.log("disconnect", id);
  if (isEmpty(cacheData[id]?.start))
    return;

  if (isEmpty(cacheData[id].end))
    cacheData[id].end = { ...cacheData[id].start };

  cacheData[id].end.endTimestampUTC = new Date().toISOString();
  cacheData[id].end.disconnectReason = "User disconnected.";

  processNewData();
});

ftpServer.listen().then((value) => {
  console.log("Systems Started");
});
