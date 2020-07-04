
'use strict';

//	I'm not the best NodeJS programmer so this is just here to make sure I don't do anything stupid.
const memwatch = require('memwatch-next');
memwatch.on('leak', (info) => 
{
  console.error('Memory leak detected:\n', info);
  
  var leakMessage = "Memory Leak Detected";
	fs.writeFile('memoryLeakDetected.txt', leakMessage, function (err) 
	{
		if (err) throw err;
		console.log('Saved MemLeak!');
	});
  
});

var app = require('express')();
var http = require('http').Server(app);
var fs = require('fs');
var io = require('socket.io')(http);
var request = require("request");
var readLastLines = require('read-last-lines');

/* import RippleAPI and support libraries */
const RippleAPI = require('ripple-lib').RippleAPI;

// Creates an instance of the rippleAPI class
const api = new RippleAPI(
{
	server: 'wss://s1.ripple.com', // Public rippled server
	timeout: 30000,	//	Timeout before RippleAPI transactions failing
	feeCushion: 1.2	//	XRP fee flexibility
});
const assert = require('assert');


// Credentials of the account placing the order - Keep this information private!
const address = 'WALLET-ADDRESS-HERE';	//	Main Wallet
const secret = 'SECRET-KEY-HERE';

// Milliseconds to wait between checks for a new ledger.
const INTERVAL = 3000;

/* Number of ledgers to check for valid transaction before failing */
const ledgerOffset = 10;
const maxFee = "0.00001";
const myInstructions = {maxLedgerVersionOffset: ledgerOffset, maxFee: maxFee};

var programStartingTime = 0;

// Variables
var fixedPoint = 5000.00;	//	This number doesn't really matter because the value gets read from a file at the start of the program

var rangeLow = 0.0075;	//	The lowest possible range for trades. 0.75%
var rangeHigh = 0.05;	//	Highest possible range for trades 5%

var rangeIncrement = 0.0010;	//	How much to increase the range percentage by after every trade. This is used to adapt to volatility
var rangeIncrementTime = 0.0001;	//	How much to decrease the range percentage by after everytime the 'decreaseRange()' function gets called. This is used to nudge a certain number of transactions per day to execute.

var rangePercentage = 0.01;	//	Starting range percentage. This value doesnt matter because it's read from a file at start of program.
var lastTradeRangePercentage = 0.00;	//	This is used to reset orders if a trade has not occured in a long time.

var closeOrders = 1;	//	When this value is '1', the program closes all outstanding orders.

var range = 0.00;

var reserveMultiplier = 0.50;		
var transactionID = 0;
var XRP = 0;
var USD = 0;

var cash = 0.00;
var cashOld = 0.00;
var cashDifference = 0.00;

var reserve = 0.00;
var reserveXRP = 0.00;

var counterparty = 0;
var pricePerShare = 0.00;
var marketValue = 0;
var state = "Stop";
var excecuteDelay = 0;
var connection = "Not connected";
var autoTraderStatus = "Disabled";
var userCount = 0;

var buyVsSell = 0;

var startTime = 0;
var stopTime = 0;

var repeatPrevention = 0;

var totalTransactions = 0;

var dayTradeGains = 0;

var orderPriceBuy = 0.00;
var orderPriceSell = 0.00;


var orderSequence = null;
var orderCancellation = null;
	
var salesMultiplier = 1.00;	
			
var tradeValue = 0.00;			
		
/////
//writeTime();	//	Only call once
//writeFiles();
/////

readFiles();
setTimeout(decreaseRange, 60000);
getPricePerShare();

for (let j = 0; j < process.argv.length; j++) 
{  
	if(j == 2)
	{
		log("Autotrader is booting up.");
		
		api.connect().then(() => 
		{
			connection = "Connected";
			
		}).catch(console.error);
		
		autoTraderStatus = "Enabled";
		state = "Start";
		setTimeout(start, 10000);
	}
    console.log(j + ' -> ' + (process.argv[j]));
}


//	We define a route handler / that gets called when we hit our website home
app.get('/', function(req, res)
{
	res.sendFile(__dirname + '/webpage/index.html');
	
});

app.get('/favicon.ico', function(req, res)
{
	res.sendFile(__dirname + '/webpage/favicon.ico');
	
});

api.on('error', (errorCode, errorMessage) => 
{
  console.log(errorCode + ': ' + errorMessage);
});

api.on('connected', () => 
{
  console.log('connected');
});

api.on('disconnected', (code) => 
{
  // code - [close code](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent) sent by the server
  // will be 1000 if this was normal closure
  console.log('disconnected, code:', code);
});

//	When user connects
io.on('connection', function(socket)
{
	userCount++;
	io.emit('userCount', userCount);
	io.emit('beep', totalTransactions);
	
	console.log('A user connected');
	io.emit('autoTraderStatus', autoTraderStatus);
	updateVariables();
	
	refresh();
	
	readLastLines.read('log.txt', 30)
    .then((lines) => 
	{
		let splitLines = lines.split(/\r?\n/);
		for(var i = 0; i < splitLines.length; i++)
		{
			socket.emit('emit', splitLines[i]);
		}
	});
	
	//	When user sends message
	socket.on('inputReceived', function(message)
	{
		console.log('Message: ' + message);
		io.emit('emit', message);
		
		if(message == "Connect")
		{
			log("Connecting to Ripple API");
			
			api.connect().then(() => 
			{
				log('Connected.');
				connection = "Connected";
				io.emit('connectionStatus', connection);
				
			}).catch(console.error);
		}
		else if(message == "Disconnect")
		{
			log("Disconnecting from Ripple API");
			
			api.disconnect().then(() => 
			{
				log('API disconnected.');
				connection = "Not connected";
				io.emit('connectionStatus', connection);
			}).catch(console.error);
		}
		else if(message == "Exit")
		{
			log("Shutting down server.");
			process.exit();
		}
		else if(message == "Start")
		{
			autoTraderStatus = "Enabled";
			io.emit('autoTraderStatus', autoTraderStatus);
			log("Starting Auto Trader");
			state = "Start";
			start();
		}
		else if(message == "Stop")
		{
			autoTraderStatus = "Disabled";
			io.emit('autoTraderStatus', autoTraderStatus);
			log("Stoping Auto Trader, please wait...");
			
			state = "Stop";
		}
		else if(message == "Reset")
		{
			writeTime();
			dayTradeGains = 0.00;
			totalTransactions = 0;	
			reserve = 0.00;			
			reserveXRP = 0.00;		

			writeFiles();
			
			setTimeout(readFiles, 1000);
			

		}
		else if(message == "BumpRange")
		{
			log("Bumping range.");
			rangePercentage = rangePercentage + rangeIncrement;
		}
		else if(message == "DropRange")
		{
			log("Dropping range.");
			rangePercentage = rangePercentage - rangeIncrement;
		}
	});
  
	
	//	When user disconnects
	socket.on('disconnect', function()
	{
		console.log('User disconnected');
		userCount--;
		io.emit('userCount', userCount);
	});

});

function start()
{
	startTimer();
	updateVariables();
	
	refresh();
	
	writeFiles();
	
	console.log('fixedPoint');
	console.log(fixedPoint);
	console.log('dayTradeGains');
	console.log(dayTradeGains);
	console.log('totalTransactions');
	console.log(totalTransactions);
	
	console.log(' ');
	console.log(' ');
	
	console.log(pricePerShare);

	if(state == "Stop")
	{
		log("Terminating Auto Trader");
		return 0;
	}
	
	api.getOrders(address).then(orders =>
	{
		
		console.log("Showing orders: ");
		console.log(" ");
		console.log(orders);
		console.log(" ");
		console.log("Number of orders: ");
		console.log(" ");
		console.log(orders.length);
		console.log(" ");
		
		
		buyVsSell = 0;
		
		// Make sure 1 buy and 1 sell
		for(var i = 0; i < orders.length; i++)
		{
			if(orders[i].specification.direction == "buy")
			{
				buyVsSell++;
			}
			else if(orders[i].specification.direction == "sell")
			{
				buyVsSell--;
			}

		}
			
		if(repeatPrevention == 0)
		{
			if(buyVsSell > 0)
			{	
				//https://ripple.com/build/rippled-apis/#book-offers
				log("We sold shares!");
				totalTransactions++;
				io.emit('beep', totalTransactions);
	
				dayTradeGains += tradeValue;
				
				let percentageCashVSMax = cash / (marketValue * reserveMultiplier);
				
				if(percentageCashVSMax > 1.0)
				{
					percentageCashVSMax =  1.0;
				}
				
				let inversePercentageCashVsMax = 1.0 - percentageCashVSMax;
				
				if(marketValue > (fixedPoint * 0.95))
				{
					reserve += parseFloat(((parseFloat(tradeValue * (reserveMultiplier / 5.00)) * parseFloat(percentageCashVSMax)) / 10.00).toFixed(2));
						
					reserveXRP += parseFloat(((parseFloat(tradeValue * (reserveMultiplier / 5.00)) * parseFloat(inversePercentageCashVsMax)) / 10.00).toFixed(4));
				}
				
				let mes = "We gained $" + parseFloat(tradeValue.toFixed(2)).toString() + " on that trade.";
				log(mes);
				
				io.emit('dayTradeGains', dayTradeGains);
			}
			else if(buyVsSell < 0)
			{
				io.emit('dayTradeGains', dayTradeGains);

				log("We bought shares!");
				totalTransactions++;
				io.emit('beep', totalTransactions);

			}
			