const io = require('socket.io-client')
const mediasoupClient = require('mediasoup-client')


const socket = io("/mediasoup") 
let device
let rtpCapabilities
let rtpCapabilities2
let producerTransport
let producer
let consumerTransport 
let consumer
let isProducer = false
let R2consumerTransport
let R2producerTransport


socket.on('connection-success' , ({ socketId,existsProducer }) => { //'connection-success' event
    console.log(socketId,existsProducer)
    document.querySelector('#socketID').textContent = 'socketID: '+socketId
})


let params = {
    //mediasoup params
    encoding:[
      {
        rid:'r0',
        maxBitrate:100000,
        scalabilityMode:'S1T3',
      },
      {
        rid:'r1',
        maxBitrate:300000,
        scalabilityMode:'S1T3',
      },
      {
        rid:'r2',
        maxBitrate:900000,
        scalabilityMode:'S1T3',
      },
    ],
    codecOptions:{
      videoGoogleStartBitrate:1000
    }
}

const streamSuccess = (stream)=>{ //success callback
    localVideo.srcObject = stream
    const track = stream.getVideoTracks()[0]
    params = { //get video track add to params
        track,
        ...params
    }

    goConnect(true)
}

const getLocalStream = () => {
    navigator.mediaDevices.getUserMedia({
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
    }).then(streamSuccess).catch(error=>{
      console.log(error.message)
    })
}

const goConsume = () => {
  goConnect(false)
}

const goConnect = (ProducerOrConsumer)=>{
  isProducer = ProducerOrConsumer
  device === undefined ? getRtpCapabilities():goCreateTransport()
}

const goCreateTransport = ()=>{
  if(isProducer){
    createSendTransport(true)
    // createSendTransport(false)//R2
  }else{
    createRecvTransport(true)
    //createSendTransport(false)
  }
}

//creat Device as https://mediasoup.org/documentation/v3/mediasoup-client/api/#Device
//for listener 
const createDevice = async()=>{
  try{
    device = new mediasoupClient.Device()

    await device.load({
      routerRtpCapabilities: rtpCapabilities,
      router2RtpCapabilities: rtpCapabilities2
    })
    console.log('Create Device')
    console.log('Device RTP Capabilities',device.rtpCapabilities)
    console.log('Device RTP Capabilities2',device.rtpCapabilities)
    //after btn2 create device go btn3
    goCreateTransport()

  }catch(error){
    console.log(error)
    if(error.name === 'UnsupportedError')
      console.warn('browser not supported')
  }
}


// after click button 2 getRtpCapabilities
const getRtpCapabilities = ()=>{
  socket.emit('CreateRoom',(data)=>{
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`)
    console.log(`Router2 RTP Capabilities... ${data.rtpCapabilities2}`)
    // document.querySelector('#Rtp_Capabilities').textContent = 'Rtp Capabilities: '+data.rtpCapabilities
    rtpCapabilities = data.rtpCapabilities
    rtpCapabilities2 = data.rtpCapabilities2
    //btn 3
    createDevice()
  })
}

const createSendTransport=(mode)=>{
  console.log('Start to create Send Transport as WebRtc transport...')

  socket.emit('createWebRtcTransport',{sender:true,mode:mode},({params})=>{
    if (params.error){
      console.log(params.error)
      return
    }
    if(mode)
      document.querySelector('#WebRtc_send_Transport_id').textContent = 'WebRtc "Send" Transport on router1 id: '+params.id
    else
      document.querySelector('#R2_WebRtc_send_Transport_id').textContent = 'WebRtc "Send" Transport on router2 id: '+params.id
    
    console.log(params)
    console.log('Create "Send Transport" Successful and waiting for connect')

    //transport connect event for producer'
    //https://mediasoup.org/documentation/v3/communication-between-client-and-server/#creating-transports
    producerTransport = device.createSendTransport(params)

    producerTransport.on('connect',async({dtlsParameters},callback,errback)=>{ // produce connect-2
      try{
        // DTLS parameters to the server side transport
        await socket.emit('transport-connect',{
          // transportId:producerTransport.id,
          dtlsParameters: dtlsParameters,
        })

        // tell the transport that parameters were transmitted
        callback()
      }catch(error){
        errback(error)
      }
    })
    producerTransport.on('produce',async(parameters,callback,errback)=>{
      console.log(parameters)

      try{
        await socket.emit('transport-produce',{
          // transportId: producerTransport.id,
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData:parameters.appData,
        },({id})=>{
          // Tell the transport that parameters were transmitted and provide it with the
          // server side producer's id.
          callback({id}) //callback to transport-produce or producer id 
          document.querySelector('#Producer_ID').textContent = 'Producer ID: '+id
        })
        
      }catch(error){
        errback(error)
      }
    })
    connectSendTransport(mode)
    
  })
}

//producer different from producer transport

const connectSendTransport = async(mode)=>{
  producer = await producerTransport.produce(params) // produce connect-1
  producer.on('trackended',()=>{
    console.log('track ended')

    // close video track
  })

  producer.on('transportclose',()=>{
    console.log('transport ended')

    // close video track
  })
  if(mode)
    createRecvTransport(true)
    // createSendTransport(false)//R2
  // goConsume()
}


const createRecvTransport = async(mode)=>{
    await socket.emit('createWebRtcTransport',{sender:false,mode:mode},({params}) =>{
      if(params.error){
        console.log(params.error)
        return
      }
      if(mode)
        document.querySelector('#WebRtc_Recv_Transport_id').textContent = 'WebRtc "Recv" Transport on router1 id: '+params.id
      else
        document.querySelector('#R2_WebRtc_Recv_Transport_id').textContent = 'WebRtc "Recv" Transport on router2 id: '+params.id

      console.log(params.id)

      console.log('Create "Recv Transport" Successful and waiting for connect')
      // create recv transport
      if(mode){
        consumerTransport = device.createRecvTransport(params)
        console.log(`consumerTransportID:${consumerTransport.id}`)
        consumerTransport.on('connect',async({dtlsParameters},callback,errback)=>{
          try{
            //signal local DTLS parameters to the server side transport
            await socket.emit('transport-recv-connect',{
              // transportId:R2consumerTransport.id,
              dtlsParameters,
            })
            //Tell transport that parameters were tansmitted
            callback()
          }catch(error){
            //tell transport that something goes wrong
            errback(error)
          }
        })
      }else{
        R2consumerTransport = device.createRecvTransport(params)
        console.log(`R2consumerTransportID:${R2consumerTransport.id}`)
        R2consumerTransport.on('connect',async({dtlsParameters},callback,errback)=>{
          try{
            //signal local DTLS parameters to the server side transport
            await socket.emit('transport-recv-connect',{
              // transportId:consumerTransport.id,
              dtlsParameters,
            })
            //Tell transport that parameters were tansmitted
            callback()
          }catch(error){
            //tell transport that something goes wrong
            errback(error)
          }
        })
      }
      connectRecvTransport(mode)
    })
}


const connectRecvTransport = async(mode)=>{
  await socket.emit('consume',{
    rtpCapabilities:device.rtpCapabilities,
    mode:mode,
  },async({params})=>{
    if(params.error){
      console.log(`${device.rtpCapabilities}`)
      console.log(`Cannot Consume ${params.error}`)
      return
    }

    console.log(params)
    consumer = await consumerTransport.consume({
      id:params.id,
      producerId:params.producerId,
      kind:params.kind,
      rtpParameters:params.rtpParameters
    })

    const{track} = consumer
    
    remoteVideo.srcObject = new MediaStream([track])
    document.querySelector('#Consumer_ID').textContent = 'Consumer ID :'+params.id
    document.querySelector('#Consume_Producer_ID').textContent = 'Consume from Producer :'+params.producerId,
    socket.emit('consumer-resume')
  })
}



btnLocalVideo.addEventListener('click', getLocalStream)
// btnRtpCapabilities.addEventListener('click', getRtpCapabilities)
// btnDevice.addEventListener('click', createDevice)
// btnCreateSendTransport.addEventListener('click', createSendTransport)
// btnConnectSendTransport.addEventListener('click', connectSendTransport)
btnRecvSendTransport.addEventListener('click', goConsume)
// btnConnectRecvTransport.addEventListener('click', connectRecvTransport)



