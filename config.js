/* ------------------------------------------
LICENSE

 * \version 
 * \date 2016-08-25
 * \author Xinyi Zhao(zxytddd@126.com)
 * \brief   configuration of lwm2m aws and http.
--------------------------------------------- */
var config = {};
config.lwm2m = {
    port: 5683,                         // Port where the server will be listening
    lifetimeCheckInterval: 1000,        // Minimum interval between lifetime checks in ms
    udpWindow: 100,
    defaultType: 'Device',
    logLevel: 'FATAL',
    ipProtocol: 'udp4',
    serverProtocol: 'udp4',
    formats: [
        {
            name: 'application-vnd-oma-lwm2m/text',
            value: 1541
        },
        {
            name: 'application-vnd-oma-lwm2m/tlv',
            value: 1542
        },
        {
            name: 'application-vnd-oma-lwm2m/json',
            value: 1543
        },
        {
            name: 'application-vnd-oma-lwm2m/opaque',
            value: 1544
        }
    ],
    writeFormat: 'application-vnd-oma-lwm2m/text'
};

// Configuration of the AWS Iot
//--------------------------------------------------
config.aws = {
	keyPath: './cert/privateKey.pem' ,
	certPath: './cert/cert.crt' ,
	caPath: './cert/rootCA.crt' ,
	clientId: 'myNode1',
	region: 'ap-southeast-1',
	// debug: true
};
// Configuration of the http server
//--------------------------------------------------
config.http = {
    port: 80,
};
module.exports = config;

