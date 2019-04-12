var MchPicUsbHidBootloader = require("../mchpicusbhidbootloader.js");
var assert = require('assert');
var path = require('path');

describe('MHCPicUsbHidBootloader when ', function() {
  describe('WriteApplicationHex on pic32mx250f128b', function() {
    it('should return ok', function(done) {
      this.timeout(120000);

      try{
        var bootloader = new MchPicUsbHidBootloader("9D008000","9D01FFFF");
        bootloader.setDebug(false);
        bootloader.setUsbDebug(false);
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
    });
  });
});