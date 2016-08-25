/* ------------------------------------------
LICENSE

 * \version 
 * \date 2016-08-25
 * \author Xinyi Zhao(zxytddd@126.com)
 * \brief	the functions about the lwm2m server.
--------------------------------------------- */
var config = require('./config').lwm2m,
	lwm2mServer = require('lwm2m-node-lib').server,
	m2mid = require('lwm2m-id'),
	async = require('async'),
	deepCopy = require('./utils').deepCopy;
/**
 * \brief	set the handle function when a client register or unregister.
 */
function setHandlers(registrationHandler, unregistrationHandler, serverInfo, callback)
{
	lwm2mServer.setHandler(serverInfo, 'registration', registrationHandler);
	lwm2mServer.setHandler(serverInfo, 'unregistration', function (device, callback) {
		unregistrationHandler(device.name);
		console.log('\nDevice unregistration:\n----------------------------\n');
		console.log('Device location: %s', device.name);
		callback();
	});
	callback();
}
/**
 * \brief	print the debug message to console.
 */
function handleResult(message)
{
	return function(error) {
		if (error) {
			console.log('Lwm2m: ERROR  \t%s', JSON.stringify(error, null, 4));
		} else {
			console.log('Lwm2m: SUCCESS\t%s', message);
		}
	};
}
/**
 * \brief	parser the resource from payload and add them to HomeState.
 			the format of payload is like this "<4/1>,<3303/0>,<3303/1>".
 */
function registerParser(endpoint, payload, homeStateNew)
{
	var out = {},
		found = payload.split('>,<'),
		state = {}, 
		key;
	found[0] = found[0].slice(1);
	found[found.length - 1] = found[found.length - 1].slice(0, found[found.length - 1].length - 1);
	for (key in found) {
		found[key] = found[key].slice(1);
		found[key] = found[key].split('/');
	}
	for (key in found) {
		if (found[key][0] < 15){
			/*if object ID is less than 15, this object is used of device management rather than home state.*/
			continue;
		}
		if (!out[found[key][0]]){
			out[found[key][0]]={};
		}
		if (found[key][1]){
			out[found[key][0]][found[key][1]]={};
		}
	}
	state = deepCopy(out);
	for (var obj in state) {
		for (var instance in state[obj]) {
			/*and the supported resources to each object.*/
			switch(obj) {
				case "3303":
					state[obj][instance]["5700"] = NaN;
					break;
				case "3311":
					state[obj][instance]["5850"] = false;
					break;
				case "3347":
					state[obj][instance]["5500"] = false;
					break;
				case "3341":
					state[obj][instance]["5527"] = "";
					break;
				default:
					break;
			}
		}
	}
	homeStateNew[endpoint] = deepCopy(state);
}
/**
 * \brief	start the lwm2m server.
 */
function start(registrationHandler, unregistrationHandler)
{
	async.waterfall([
		async.apply(lwm2mServer.start, config),
		async.apply(setHandlers, registrationHandler, unregistrationHandler),
	], handleResult('Server started'));
}
/**
 * \brief	write the value to a specific resource.
 */
function write(endpoint, Oid, i, Rid, value, callback)
{
	var def = m2mid.getRdef(Oid, Rid),
		cb;
	if (!def) {
		handleResult()("Invalid Oid and Rid" + Oid + ": " + Rid);
	}
	if (def.access == 'R') {
		if (callback) {
			callback();
		}
		return ;
	}
	lwm2mServer.getDevice(endpoint, function (num, device) {
		if (device === undefined) {
			return;
		}
		var payload;
		switch(def.type) {
			case "boolean":
				payload = value ? '1' : '0';
				break;
			case "float":
				payload = value.toString();
				break;
			case "opaque":
				payload = value;
				break;
			default:
				payload = value.toString();
				break;
		}
		if (payload !== undefined) {
			if (callback) {
				cb = callback;
			} else {
				cb = handleResult('Write to client');
			}
			lwm2mServer.write(device.id, Oid, i, Rid, payload, cb);
		} else {
			handleResult()("Write to client: Wrong data type");
		}
	});
}
/**
 * \brief	read the value from a specific resource.
 */
function read(endpoint, Oid, i, Rid, callback)
{
	lwm2mServer.getDevice(endpoint, function (num, device) {
		var cb;
		if (device === undefined){
			return;
		}
		if (callback) {
			cb = callback;
		} else {
			cb = function (err, res) {
				console.log(err);
				handleResult(endpoint+":"+Oid+"/"+i+"/"+Rid+"\t"+res)(err);
			};
		}
		lwm2mServer.read(device.id, Oid, i, Rid, cb);
});
}
/**
 * \brief	execute the command of a specific resource.
 */
function execute(endpoint, Oid, i, Rid, callback)
{
	lwm2mServer.getDevice(endpoint, function (num, device) {
		var cb;
		if (device === undefined)
			return;
		if (callback) {
			cb = callback;
		} else {
			cb = handleResult('Command executed');
		}
		lwm2mServer.execute(device.id, Oid, i, Rid, null, cb);
	});
}
/**
 * \brief	observe a specific resource.
 */
function observe(endpoint, Oid, i, Rid, handle, callback)
{
	lwm2mServer.getDevice(endpoint, function (num, device) {
		if (device === undefined) {
			return;
		}
		lwm2mServer.observe(device.id, Oid, i, Rid, handle, callback);
	});
}
/**
 * \brief	list all client and its resources.
 */
function listClients(resourceShow)
{
	lwm2mServer.listDevices(function (error, deviceList) {
		if (error) {
			handleResult()(error);
		} else {
			console.log('\nDevice list:\n----------------------------\n');
			for (var i=0; i < deviceList.length; i++) {
				console.log('-> Device Id "%s"', deviceList[i].id);
				console.log('\n%s\n', JSON.stringify(deviceList[i], null, 4));
				resourceShow(deviceList[i].name);
			}
		}
	});
}

module.exports.read = read;
module.exports.write = write;
module.exports.start = start;
module.exports.execute = execute;
module.exports.observe = observe;
module.exports.listClients = listClients;
module.exports.registerParser = registerParser;
