require("dotenv").config();

const FtpSrv = require("ftp-srv");
const { networkInterfaces } = require('os');
const { Netmask } = require('netmask');
const path = require('path');
const fs = require('fs');

// const { EarpLog } = require("./models/earplogModel");

global.logArray = [];

async function createEarpLog(data, recordCount) {
  // await EarpLog(data,recordCount);
}

// function logData(startTimestamp, endTimestamp, bytesTx, disconnectReason, ipAddress, port, fileName, serialNo) {

//   if (!startTimestamp || !endTimestamp || !bytesTx || !disconnectReason || !ipAddress || !port || !fileName || !serialNo) {
//     // console.error('One or more required arguments are missing.');
//     return;
// }

//     let log = {
//         "startTimestampUTC": startTimestamp,
//         "endTimestampUTC": endTimestamp,
//         "bytesTx": bytesTx,
//         "disconnectReason": disconnectReason,
//         "ipAddress": ipAddress,
//         "port": port,
//         "fileName": fileName,
//         "serialNo": serialNo
//     };

//     global.logArray.push(log);

//     let numberOfLogs = global.logArray.length;

//     createEarpLog(global.logArray, numberOfLogs);

//     console.log('Log data stored. Total number of logs:', numberOfLogs);

//     setTimeout(() => {
//         global.logArray.shift();
//         console.log('Log data removed. Total number of logs:', global.logArray.length);
//     }, 5000);
// }

// setInterval(logData, 5000);

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
    let BytesTx;
    if (await checkUser(username, password)) {
      resolve({
        root: `${process.cwd()}/downloads/`
    });
      console.log(`{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"","bytesTx":${BytesTx},"disconnectReason":"","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"","serialNo":"","clientId":"${Logger.id}"}`);
    } else {
      const endTimestamp = new Date();
      reject("Bad username or password");
      console.log(`{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"${endTimestamp.toISOString()}","bytesTx":${BytesTx},"disconnectReason":"Bad username or password","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"","serialNo":"${username}"},"clientId":"${Logger.id}"`);
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

    ftpServer.on("disconnect", (connection, id, newConnectionCount) => {
      // createEarpLog(`{"startTimestampUTC":"","endTimestampUTC":"${timestamp.toISOString()}","bytesTx":123,"disconnectReason":"User disconnected.","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"${fileName}","serialNo":"${username}"}`, 1);
      // console.log('User disconnected:', connection);
      // console.log('Files uploaded by this user:', filesUploaded[username]);
      const endTimestamp = new Date();
      console.log(`{"startTimestampUTC":"${startTimestamp.toISOString()}","endTimestampUTC":"${endTimestamp.toISOString()}","bytesTx":${BytesTx},"disconnectReason":"User disconnected.","ipAddress":"${Peer.address}","port":${Peer.port},"fileName":"${filename}","serialNo":"${SerialNo}","clientId":"${Logger.id}"}`);
    });
  }
);

ftpServer.listen().then((value) => {
  console.log("Systems Started");
});
