var http = require("http");
var io = require("socket.io");
var client = require("node-static");
var config = require("./sys/config.js");
var Util = require("./class/Util.js");
var User = require("./class/User.js");
var Tracker = require("./class/Tracker.js");

//Static server to serve the dashboard
var file = new(client.Server)('./public/');
var viewServer = http.createServer(function(req, res) {
	req.addListener('end', function() {
		file.serve(req, res);
	});
}).listen(config.dashboardPort);

var clientSocket = io.listen(config.socketPort, {
	"log level": 0
});
var dashboardSocket = io.listen(viewServer, {
	"log level": 0
});

//Object to hold all trackers
var allTrackers = {};

//Data that will be sent to the dashboard
var payload = {
	totalConnections: 0,
	browsers: {
		count: {
			"Chrome": 0,
			"Firefox": 0,
			"Safari": 0,
			"Opera": 0,
			"IE": 0,
			"Android": 0,
			"iPad": 0,
			"iPhone": 0,
			"Other": 0
		}
	},
	trackers: [],
	screenResolutions: {},
	os: {}
};

dashboardSocket.sockets.on("connection", function(client) {
	//Immediately send stats to the dashboard upon request
	Tracker.sendPayload(allTrackers, payload, config, dashboardSocket);
});

clientSocket.sockets.on('connection', function(client) {
	
	//When a tracker emits a beacon then do necessary processing
	client.on('beacon', function(data) {
		
		payload.totalConnections++;
		
		//The client id uniquely identifies a user
		var userData = {
				"sessionId": client.id,
				"browser": Util.getBrowser(client.handshake.headers["user-agent"]),
				"screenWidth": data.screenWidth,
				"screenHeight": data.screenHeight,
				"os": Util.getOs(data.os)
		};
		
		//Increment the appropriate browser count
		payload.browsers.count[userData.browser]++;
		var newUser = new User(userData);
		
		//If an object tracking the URL already exists then increment the number of connections and assign the new user
		if(allTrackers.hasOwnProperty(client.handshake.headers.referer)) {
			allTrackers[client.handshake.headers.referer].numConnections++;
			allTrackers[client.handshake.headers.referer].clients[client.id] = newUser;
		}
		
		//Otherwise create a new tracker and user and assign it to the URL
		else {
			var newTracker = new Tracker(newUser, client.handshake.headers.referer);
			allTrackers[client.handshake.headers.referer] = newTracker;
			allTrackers[client.handshake.headers.referer].numConnections = 1;
		}
		
		//Get the string value for the screen resolution and add it to the payload if it doesn't exist
		var screenResolution = newUser.getScreenResolution();
		if(payload.screenResolutions.hasOwnProperty(screenResolution)) {
			payload.screenResolutions[screenResolution]++;
		}
		else {
			payload.screenResolutions[screenResolution] = 1;
		}
		
		//Add the OS to the payload if it doesn't exist
		if(payload.os.hasOwnProperty(userData.os)) {
			payload.os[userData.os]++;
		}
		else {
			payload.os[userData.os] = 1;
		}
		
		//Send the data back
		Tracker.sendPayload(allTrackers, payload, config, dashboardSocket);
		
	});
	
	client.on('disconnect', function() {
		
		//Avoid the race condition of a client connecting but disconnecting before the data is sent to the server
		if(allTrackers[client.handshake.headers.referer].clients.hasOwnProperty(client.id)) {
			
			//Decrement the total connections
			payload.totalConnections--;
			
			//Get the appropriate tracker to work with
			var killedTracker = allTrackers[client.handshake.headers.referer].clients[client.id];
			
			//Decrement the number of connections to a given URL
			allTrackers[client.handshake.headers.referer].numConnections--;
			
			//Decrement the appropriate browser count
			payload.browsers.count[killedTracker.browser]--;
			
			//Decrement the appropriate screen resolution count
			payload.screenResolutions[killedTracker.getScreenResolution()]--;
			
			//Remove the resolution if the count is 0
			if(payload.screenResolutions[killedTracker.getScreenResolution()] == 0) {
				delete payload.screenResolutions[killedTracker.getScreenResolution()];
			}
			
			//Decrement the appropriate operating system count
			payload.os[killedTracker.getOs()]--;
			
			//Remove the operating system if the count is 0
			if(payload.os[killedTracker.getOs()] == 0) {
				delete payload.os[killedTracker.getOs()];
			}
			
			//Remove the URL if there are no connections to it
			if(allTrackers[client.handshake.headers.referer].numConnections == 0) {
				delete allTrackers[client.handshake.headers.referer];
			}
			
			//Otherwise remove the specific client
			else {
				delete allTrackers[client.handshake.headers.referer].clients[client.id];
			}
			
			//Send the data back after manipulation
			Tracker.sendPayload(allTrackers, payload, config, dashboardSocket);
		}
		
	});
	
});
