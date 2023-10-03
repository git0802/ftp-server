require("dotenv").config();

const Sequelize = require("sequelize");

const sequelize = new Sequelize(process.env.MSSQL_DATABASE_NAME, process.env.MSSQL_USERNAME, process.env.MSSQL_PASSWORD, {
  host: process.env.MSSQL_IP_ADDRESS,
  port: process.env.MSSQL_IP_PORT,
  dialect: 'mssql',
  dialectOptions: {
    options: {
      useUTC: false,
      dateFirst: 1,
    },
  },
});

sequelize.authenticate()
  .then(() => {
    console.log('Connection has been established successfully.');
  })
  .catch(err => {
    console.error('Unable to connect to the database:', err);
  });

const EarpLog = async (data, recordCount) => {
  try {
    recordCount = parseInt(recordCount);

    const result = await sequelize.query(
      "PSFTPConnectBulkDev @Data=:data, @RecordCount=:recordCount",
      { replacements: { data: data, recordCount: recordCount } }
    );
    console.log(result);
    return result;
  } catch (error) {
    console.error(error);
  }
};

module.exports = {
  EarpLog: EarpLog,
};