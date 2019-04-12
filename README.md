# mchpic-usbhid-bootloader
Microchip PIC USB-HID Bootloader Client side on nodejs

Simple client side bootloader for Microchip pic family device microcontrollers. The bootloader is based on Harmony bootloader library v1.11 which is based on the AN1388 specification, you can find this documents on the doc folder of the project.

The module is in early stages and is tested only on a pic32mx250f128b device. To test on this device:

1 - Program the device with the unified hex on the resurces folder, you will probably need a device debugger / programmer like pickit
2 - Connect the device to usb port
3 - Install module with npm install
4 - Put device on bootloader mode running node bootloader.js (the bootloader.js is on the device specific folder on resources) <- pending to delegate this part to the test
5 - run npm test
