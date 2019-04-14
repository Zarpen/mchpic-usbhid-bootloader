var MchPicUsbHidBootloader = require("../mchpicusbhidbootloader.js");
var assert = require('assert');
var path = require('path');
var usb = require('usb');
var bootloader = new MchPicUsbHidBootloader("9D008000","9D01FFFF");
bootloader.setDebug(false);
bootloader.setUsbDebug(false);

function startBootloader(callback){
  try{
    bootloader.openUsb("0x04D8","0x003F");
    bootloader.sendCommand(Buffer.from([MchPicUsbHidBootloader.commands.VERSION]),1000).then(function(value){
      try{
        bootloader.closeUsb();
      }catch(err){}

      setTimeout(function(){
        if(value.minorVer == 1 && value.majorVer == 4){
          callback();
        }else{
          callback(true);
        }
      },1000);
    }).catch(function(bootError){
      try{
        bootloader.closeUsb();
      }catch(err){}

      setTimeout(function(){
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
          if(err){
            callback(err);
          }else{
            inEndPoint.transfer(64,function(subErr, data){
              if(subErr){
                callback(subErr);
              }else{
                if(data[0] == 0x81){
                  outEndPoint.transfer(Buffer.from([0x81]),function(subSubErr){
                    try{
                      inEndPoint.stopPoll();
                      device.interfaces[0].release(true,function(subSubSubErr){});
                      device.close();
                    }catch(e){}

                    setTimeout(function(){
                      bootloader.openUsb("0x04D8","0x003F");
                      bootloader.sendCommand(Buffer.from([MchPicUsbHidBootloader.commands.VERSION]),1000).then(function(subValue){
                        try{
                          bootloader.closeUsb();
                        }catch(err){}

                        setTimeout(function(){
                          if(subValue.minorVer == 1 && subValue.majorVer == 4){
                            callback();
                          }else{
                            callback(true);
                          }
                        },1000);
                      }).catch(function(subBootError){
                        callback(subBootError);
                      });
                    },1000);
                  });
                }else{
                  callback(true);
                }
              }
            });
          }
        });
      },1000);
    });
  }catch(e){
    callback(e);
  }
}

describe('MHCPicUsbHidBootloader when ', function() {
  describe('WriteApplicationHex on pic32mx250f128b', function() {
    this.timeout(120000);

    it('should return ok', function(done) {
      startBootloader(function(err){
        if(err){
          done("Test fail with " + err);
        }else{
          try{
            bootloader.openUsb("0x04D8","0x003F");
            bootloader.eraseAndWrite(path.join(__dirname, '.', 'test.hex'),true).then(function(value){
              setTimeout(function(){
                try{
                  bootloader.closeUsb();
                }catch(err){}
                done();
              },1000);
            }).catch(function(err){
              done("Test fail with " + err);
            });
          }catch(err){
            done("Test fail with " + err);
          }
        }
      });
    });
  });
});