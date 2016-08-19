var config = require('./config').lwm2m,
	lwm2mServer = require('lwm2m-node-lib').server,
	m2mid = require('lwm2m-id'),
	async = require('async'),
	deepCopy = require('./utils').deepCopy;

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

function registerParser(endpoint, payload, homeStateNew)
{
	var out = {},
		found = payload.split('>,<'),
		reported = {}, 
		desired={},
		key;
	found[0] = found[0].slice(1);
	found[found.length - 1] = found[found.length - 1].slice(0, found[found.length - 1].length - 1);
	for (key in found) {
		found[key] = found[key].slice(1);
		found[key] = found[key].split('/');
	}
	for (key in found) {
		if (found[key][0] < 15)
			continue;
		if (!out[found[key][0]])
			out[found[key][0]]={};
		if (found[key][1])
			out[found[key][0]][found[key][1]]={};
	}
	reported = deepCopy(out);
	for (var obj in reported) {
		for (var instance in reported[obj]) {
			switch(obj) {
				case "3303":
					reported[obj][instance]["5700"] = NaN;
					break;
				case "3311":
					reported[obj][instance]["5850"] = false;
					break;
				case "3347":
					reported[obj][instance]["5500"] = false;
					break;
				case "3341":
					reported[obj][instance]["5527"] = "";
					break;
				default:
					break;
			}
		}
	}
	homeStateNew[endpoint] = deepCopy(reported);
}

function start(registrationHandler, unregistrationHandler)
{
	async.waterfall([
		async.apply(lwm2mServer.start, config),
		async.apply(setHandlers, registrationHandler, unregistrationHandler),
	], handleResult('Server started'));
}

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
		if (payload !== null) {
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

function read(endpoint, Oid, i, Rid, callback)
{
	lwm2mServer.getDevice(endpoint, function (num, device) {
		var cb;
		if (device === null)
			return;
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

function execute(endpoint, Oid, i, Rid, callback)
{
	lwm2mServer.getDevice(endpoint, function (num, device) {
		var cb;
		if (device === null)
			return;
		if (callback) {
			cb = callback;
		} else {
			cb = handleResult('Command executed');
		}
		lwm2mServer.execute(device.id, Oid, i, Rid, null, cb);
	});
}

function observe(endpoint, Oid, i, Rid, handle, callback)
{
	lwm2mServer.getDevice(endpoint, function (num, device) {
		if (device === null) {
			return;
		}
		lwm2mServer.observe(device.id, Oid, i, Rid, handle, callback);
	});
}

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
