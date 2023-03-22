const io = require('socket.io-client')

const socket = io("/mediasoup") 

socket.on('connection-success' , ({ socketId }) => { //'connection-success' event
    console.log(socketId)
    document.querySelector('#socketID').textContent = 'socketID: '+socketId
})

let params = {
    //mediasoup params
}

const streamSuccess = async (stream)=>{ //success callback
    localVideo.srcObject = stream
    const track = stream.getVideoTrack()[0]
    params = { //get video track add to params
        track,
        ...params
    }
}

const getLocalStream = () => {
    navigator.getUserMedia({
      audio: false,
      video: {
        width: {
          min: 640,
          max: 1920,
        },
        height: {
          min: 400,
          max: 1080,
        }
      }
    }, streamSuccess, error => {
      console.log(error.message)
    })
}

btnLocalVideo.addEventListener('click', getLocalStream)
// btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
// btnDevice.addEventListener('click', createDevice)
// btnCreateSendTransport.addEventListener('click', createSendTransport)
// btnConnectSendTransport.addEventListener('click', connectSendTransport)
// btnRecvSendTransport.addEventListener('click', createRecvTransport)
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport)



