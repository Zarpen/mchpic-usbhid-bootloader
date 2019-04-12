var usb = require('usb');
//usb.setDebugLevel(4);
var device = usb.findByIds("0x04D8", "0x003F");
device.open();
var devInterface = device.interfaces[0];
if(devInterface.isKernelDriverActive()){
	console.log("Detach driver");
	devInterface.detachKernelDriver();
	//devInterface.attachKernelDriver();
}
devInterface.claim();
var inPos = devInterface.endpoints[0].direction == "in" ? 0 : 1;
var outPos = devInterface.endpoints[1].direction == "out" ? 1 : 0;
var inEndPoint = devInterface.endpoints[inPos];
var outEndPoint = devInterface.endpoints[outPos];

outEndPoint.transfer(Buffer.from([0x80]),function(err){
        if(err) console.log("bootloader command send error " + err);
        console.log("bootloader command send ok");
});
inEndPoint.transfer(64,function(error, data){
        if(error) console.log("bootloader command response error " + error);
        if(data[0] == 0x81){
        	console.log("bootloader command response ok");
        	outEndPoint.transfer(Buffer.from([0x81]),function(err){
			        if(err) console.log("reset command send error " + err);
			        console.log("reset command send ok");
			});
			releaseAll();
        }
});

var exceptionOccured = false;
process.on('uncaughtException', function(err) {
    console.log('Caught exception: ' + err);
    exceptionOccured = true;
    process.exit();
});

var releaseAll = function(){
	try{
		if(exceptionOccured) console.log('Exception occured');
    else console.log('Kill signal received');
    inEndPoint.stopPoll();
    device.interfaces[0].release(true,function(err){
        console.log("error on interface release");
    });
    device.close();
	}catch(e){
		
	}
    process.exit();
}

process.on('exit', function(code) {
    releaseAll();
});

process.on('SIGTERM', function(code) {
    releaseAll();
});

process.on('SIGINT', function(code) {
    releaseAll();
});

// keep running
setInterval(function() {
    console.log("timer that keeps nodejs processing running");
}, 1000 * 60 * 60);
