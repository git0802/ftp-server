require("dotenv").config();

const FtpSrv = require("ftp-srv");
const { networkInterfaces } = require('os');
const { Netmask } = require('netmask');
const path = require('path');
const fs = require('fs');

// const { EarpLog } = require("./models/earplogModel");

const dataBatch = [];
let batchCounter = 0;
const batchSize = 500;
const batchTime = 60000;

async function createEarpLog(data, recordCount) {
  // await EarpLog(data,recordCount);
  console.log("data", data);
  console.log("record Count", recordCount);
}

function processNewData(newData) {
  dataBatch.push(newData);
  batchCounter++;

  if (batchCounter >= batchSize) {
    createEarpLog(dataBatch.join(), batchCounter);
    dataBatch.length = 0;
    batchCounter = 0;
  }
}

setInterval(() => {
  if (dataBatch.length > 0) {
    createEarpLog(dataBatch.join(), batchCounter);
    dataBatch.length = 0;
    batchCounter = 0;
  }
}, batchTime);

async function checkUser(username, password) {  
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
   // const networks = {
   //     '$GATEWAY_IP/32': `${public_ip}`, 
   //     '10.0.0.0/8'    : `${lan_ip}`
   // } 
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
  url: `ftp://0.0.0.0:${process.env.FTPSRV_PORT || 21}`,
  pasv_url: resolverFunction,
  pasv_min: 5054,
  pasv_max: 5055,
  file_format: 'ls',
  blacklist: ["DELE", "RNTO", "RETR"],
  greeting: ["h0h0h0"],
  anonymous: false,
});

ftpServer.on(
  "login",
  async ({ connection, username, password }, resolve, reject) => {
    const Logger = connection.log.fields;
    const Peer = connection.commandSocket._peername;
    const startTimestamp = new Date();
    let filename;
    let SerialNo;
    let BytesTx = 0;
    let data;
    if (await checkUser(username, password)) {
      resolve({
        root: `${process.cwd()}/downloads/`
    });

    // data = `{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"","bytesTx":${BytesTx},"disconnectReason":"","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"","serialNo":"","clientId":"${Logger.id}"}`;
    data = `{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"","bytesTx":${BytesTx},"disconnectReason":"","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"","serialNo":""}`;

    processNewData(data);
    
      console.log(data);
    } else {
      const endTimestamp = new Date();
      reject("Bad username or password");
      // data = `{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"${endTimestamp.toISOString()}","bytesTx":${BytesTx},"disconnectReason":"Bad username or password","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"","serialNo":"${username}"},"clientId":"${Logger.id}"`; 
      data = `{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"${endTimestamp.toISOString()}","bytesTx":${BytesTx},"disconnectReason":"Bad username or password","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"","serialNo":"${username}"}`;

      processNewData(data);

      console.log(data);
    }

    connection.on("STOR", (error, filePath) => {
      if (error) {
        console.error(error);
        return;
    }
      console.log(filePath, " uploaded by ", username);
      filename = path.basename(filePath);
      SerialNo = filename.split('_')[0];
      BytesTx = fs.statSync(filePath).size;
    });

    ftpServer.on("disconnect", () => {
      const endTimestamp = new Date();
      // data = `{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"${endTimestamp.toISOString()}","bytesTx":${BytesTx},"disconnectReason":"User disconnected.","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"${filename}","serialNo":"${SerialNo}","clientId":"${Logger.id}"}`;
      data = `{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"${endTimestamp.toISOString()}","bytesTx":${BytesTx},"disconnectReason":"User disconnected.","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"${filename}","serialNo":"${SerialNo}"}`;

      processNewData(data);

      console.log(data);
    });
  }
);

ftpServer.listen().then((value) => {
  console.log("Systems Started");
});
