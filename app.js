/**
 * integrating mediasoup server with a node.js application
 */

/* Please follow mediasoup installation requirements */
/* https://mediasoup.org/documentation/v3/mediasoup/installation/ */
import express from 'express'
const app = express()
import redis from 'redis'
import https from 'httpolyglot'
import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()

import { Server } from 'socket.io'
import mediasoup from 'mediasoup'
import {PubSub} from '@google-cloud/pubsub'

app.get('*', (req, res, next) => {
  const path = '/sfu/'

  if (req.path.indexOf(path) == 0 && req.path.length > path.length) return next()

  res.send(`You need to specify a room name in the path e.g. 'https://127.0.0.1/sfu/room'`)
})

app.use('/sfu/:room', express.static(path.join(__dirname, 'public')))

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync('./server/ssl/key.pem', 'utf-8'),
  cert: fs.readFileSync('./server/ssl/cert.pem', 'utf-8')
}

const httpsServer = https.createServer(options, app)
httpsServer.listen(3000, () => {
  console.log('listening on port: ' + 3000)
})

const io = new Server(httpsServer)

// socket.io namespace (could represent a room?)
const connections = io.of('/mediasoup')

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer 
 **/
let worker
let rooms = {}          // { roomName1: { Router, rooms: [ sicketId1, ... ] }, ...}
let peers = {}          // { socketId1: { roomName1, socket, transports = [id1, id2,] }, producers = [id1, id2,] }, consumers = [id1, id2,], peerDetails }, ...}
let transports = []     // [ { socketId1, roomName1, transport, consumer }, ... ]
let producers = []      // [ { socketId1, roomName1, producer, }, ... ]
let consumers = []      // [ { socketId1, roomName1, consumer, }, ... ]
let pipeproducers = []
let pipeconsumers = []
let incoming = {
  IP:[],
  Port:[]
}
let ProjectID = 'mplus-video-conference-dev'
let topicName = 'mediasoupv1'
let subscriptionName = 'mediasoupv2-sub'
let AnnouncedIP = '35.236.182.41'
let selector = true
let VM1_IP = '35.236.182.41'
let VM2_IP = '35.194.157.28'
let redis_ip = '35.194.211.137'
const pub = new PubSub();
const sub = new PubSub();
const subscription = sub.subscription(subscriptionName);

const redisCli = redis.createClient('6379',redis_ip);
(async () => {
  await redisCli.connect();
})();
redisCli.on('error',function(error){
  console.error('redis client error',error);
})

redisCli.on("ready", () => {
  console.log("Connected!");
  console.log(redisCli.isReady)
  redisCli.subscribe("REQUESTFORPIPING")
  // redisCli.set("key", "value", redis.print);
  // redisCli.get("key", redis.print);
});



async function createTopic(
  projectId = ProjectID , // Your Google Cloud Platform project ID
  topicName = topicName // Name for the new topic to create
) {
  // Instantiates a client
  const pubsub = new PubSub({ projectId });

  // Creates the new topic
  const [topic] = await pubsub.createTopic(topicName);
  console.log(`Topic ${topic.name} created.`);
}

async function publishMessage(customAttributes) {

  // publishMessage({
  //   Topic:topicName, 
  //   data:"Consume",
  //   IP: AnnouncedIP,
  //   PORT:'Consume',
  //   event:'canConsume',
  //   SRTP : 'undefined',
  //   producerId:Producer.id
  //   });
  // topicName, data, PORT,event,SRTP = 'undefined',producerId='undefined'

  const dataBuffer = Buffer.from(customAttributes.data);
  // PORT = PORT.toString()
  // let customAttributes
  // if(SRTP==='undefined'){
  //   customAttributes = {
  //     Event:event,
  //     IP: AnnouncedIP,
  //     Port: PORT,
  //     Srtp: SRTP,
  //     ProducerID:producerId,
  //   };
  // }else {
  //   customAttributes = {
  //     Event:event,
  //     IP: AnnouncedIP,
  //     Port: PORT,
  //     Srtp_Suite: SRTP.cryptoSuite,
  //     Srtp_keyBase: SRTP.keyBase64,
  //   };
  // }
  console.log('Message Out: ',customAttributes.event,customAttributes.IP,customAttributes.PORT)
  const messageId = await pub.topic(customAttributes.Topic).publishMessage({data: dataBuffer, attributes: customAttributes})
  console.log(`Message ${messageId} published.`);
}

function listenForMessages(subscriptionName, timeout) {
  // const pubsub = new PubSub();
  const subscription = sub.subscription(subscriptionName);
  // Create an event handler to handle messages
  let messageCount = 0;
  // const messageHandler = message => {
  //   console.log(`Received message ${message.id}:`);
  //   console.log(`\tData: ${message.data}`);
  //   console.log(`\tAttributes: ${message.attributes},${message.attributes.Add},${message.attributes.IP},${message.attributes.Port}`);
  //   if(message.attributes.Add==='true'){
  //     incoming.IP.push(message.attributes.IP)
  //     incoming.Port.push(message.attributes.Port)
  //   }else{
  //     let index = incoming.IP.indexOf(message.attributes.IP);
  //     incoming.IP.splice(index, 1);
  //     index = incoming.Port.indexOf(message.attributes.Port);
  //     incoming.Port.splice(index, 1);
  //   }
    
  //   messageCount += 1;

  //   // "Ack" (acknowledge receipt of) the message
  //   message.ack();
  //   console.log('Message:',incoming.IP,',',incoming.Port)
  // };
  // subscription.on(`message`, messageHandler);

  // setTimeout(() => {
  //   subscription.removeListener('message', messageHandler);
  //   console.log(`${messageCount} message(s) received.`);
  // }, timeout * 1000);
}

const messageHandler = message => {
  console.log(`Received message ${message.id}:${pipe}`);
  console.log(`\tData: ${message.data}`);
  console.log(`\tAttributes: ${message.attributes},${message.attributes.IP},${message.attributes.Port}`);
  // if(message.attributes.Add==='true'){
  //   incoming.IP.push(message.attributes.IP)
  //   incoming.Port.push(message.attributes.Port)
  // }else{
  //   let index = incoming.IP.indexOf(message.attributes.IP);
  //   incoming.IP.splice(index, 1);
  //   index = incoming.Port.indexOf(message.attributes.Port);
  //   incoming.Port.splice(index, 1);
  // }
  
  // messageCount += 1;

  // "Ack" (acknowledge receipt of) the message
  message.ack();
  console.log('Message:',incoming.IP,',',incoming.Port)
};


const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  })
  console.log(`worker pid ${worker.pid}`)
  // listenForMessages(subscriptionName, 3);
  worker.on('died', error => {
    // This implies something serious happened, so kill the application
    console.error('mediasoup worker has died')
    setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
  })

  return worker
}

// We create a Worker as soon as our application starts
worker = createWorker()

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
]

connections.on('connection', async socket => {
  console.log(socket.id)
  socket.emit('connection-success', {
    socketId: socket.id,
  })

  const removeItems = (items, socketId, type) => {
    items.forEach(item => {
      if (item.socketId === socket.id) {
        item[type].close()
      }
    })
    items = items.filter(item => item.socketId !== socket.id)

    return items
  }

  socket.on('disconnect', () => {
    // do some cleanup
    console.log('peer disconnected')
    if(peers[socket.id]!==undefined){
      if(peers[socket.id]!==undefined){
        pipeproducers.forEach(item => {
          if (item.socketId === socket.id) 
            publishMessage({
              Topic:topicName, 
              data:"IP & Port",
              IP: AnnouncedIP,
              PORT:item.Port,
              event:'DISCONNECT_PIPE',
              SRTP : 'undefined',
              producerId:'undefined'
              });
        })
      }
      consumers = removeItems(consumers, socket.id, 'consumer')
      producers = removeItems(producers, socket.id, 'producer')
      pipeproducers = removeItems(pipeproducers, socket.id, 'producer')
      pipeconsumers = removeItems(pipeconsumers, socket.id, 'consumer')
      transports = removeItems(transports, socket.id, 'transport')
      // console.log('disconnect',peers[socket.id])
      const { roomName } = peers[socket.id]
      delete peers[socket.id]

      // remove socket from room
      rooms[roomName] = {
        router: rooms[roomName].router,
        peers: rooms[roomName].peers.filter(socketId => socketId !== socket.id)
      }
    }
    
  })

  socket.on('joinRoom', async ({ roomName }, callback) => {
    console.log('new peers join \'',roomName,'\'')
    publishMessage({
      Topic:topicName, 
      data:"Create pipe transport",
      IP: AnnouncedIP,
      PORT:'1',
      event:'CREATE_PIPE',
      SRTP : 'undefined',
      producerId:'undefined'
      });
    // publishMessage(topicName, "Create pipe transport",1,'CREATE_PIPE');
    // create Router if it does not exist
    // const router1 = rooms[roomName] && rooms[roomName].get('data').router || await createRoom(roomName, socket.id)
    const router1 = await createRoom(roomName, socket.id)

    peers[socket.id] = {
      socket,
      roomName,           // Name for the Router this Peer joined
      transports: [],
      producers: [],
      pipeproducers: [],
      consumers: [],
      pipeconsumers: [],
      OnVM_P: [],
      OnVM_C: [],
      peerDetails: {
        name: '',
        isAdmin: false,   // Is this Peer the Admin?
      }
    }
    if(AnnouncedIP === VM1_IP){
      selector = true
    }else{
      selector = false
    }
    // get Router RTP Capabilities
    const rtpCapabilities = router1.rtpCapabilities
    console.log('joinRoom',selector)
    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities ,selector })
  })

  const createRoom = async (roomName, socketId) => {
    // worker.createRouter(options)
    // options = { mediaCodecs, appData }
    // mediaCodecs -> defined above
    // appData -> custom application data - we are not supplying any
    // none of the two are required
    let router1
    let peers = []
    if (rooms[roomName]) {
      router1 = rooms[roomName].router
      peers = rooms[roomName].peers || []
    } else {
      router1 = await worker.createRouter({ mediaCodecs, })
    }
    
    console.log(`Router ID: ${router1.id}`, peers.length)

    rooms[roomName] = {
      router: router1,
      peers: [...peers, socketId],
    }

    return router1
  }

  // socket.on('createRoom', async (callback) => {
  //   if (router === undefined) {
  //     // worker.createRouter(options)
  //     // options = { mediaCodecs, appData }
  //     // mediaCodecs -> defined above
  //     // appData -> custom application data - we are not supplying any
  //     // none of the two are required
  //     router = await worker.createRouter({ mediaCodecs, })
  //     console.log(`Router ID: ${router.id}`)
  //   }

  //   getRtpCapabilities(callback)
  // })

  // const getRtpCapabilities = (callback) => {
  //   const rtpCapabilities = router.rtpCapabilities

  //   callback({ rtpCapabilities })
  // }

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on('createWebRtcTransport', async ({ consumer ,OnVM}, callback) => {
    const roomName = peers[socket.id].roomName
    const router = rooms[roomName].router
    console.log('createWebRtcTransport for consumer',consumer,'on VM :',OnVM?'1':'2')

    createWebRtcTransport(router).then(
      transport => {
        callback({
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          }
        })

        // add transport to Peer's properties
        addTransport(transport, roomName, consumer,OnVM)
      },
      error => {
        console.log(error)
      })
  })

  const addTransport = (transport, roomName, consumer, OnVM) => {

    transports = [
      ...transports,
      { socketId: socket.id, transport, roomName, consumer, OnVM}
    ]

    peers[socket.id] = {
      ...peers[socket.id],
      transports: [
        ...peers[socket.id].transports,
        transport.id,
      ]
    }
  }

  const addProducer = (producer, roomName, OnVM) => {
    producers = [
      ...producers,
      { socketId: socket.id, producer, roomName, OnVM}
    ]

    peers[socket.id] = {
      ...peers[socket.id],
      producers: [
        ...peers[socket.id].producers,
        producer.id,
      ],
      OnVM_P: [
        ...peers[socket.id].OnVM_P,
        OnVM,
      ]
    }
  }

  const addPipe = (producer,consumer, roomName,site,Dir,Port) => {
    pipeproducers = [
      ...pipeproducers,
      { socketId: socket.id, producer, roomName, site, Dir,Port}
    ]
    pipeconsumers = [
      ...pipeconsumers,
      { socketId: socket.id, consumer, roomName, site, Dir,Port}
    ]

    peers[socket.id] = {
      ...peers[socket.id],
      pipeproducers: [
        ...peers[socket.id].pipeproducers,
        producer.id,
      ],
      pipeconsumers: [
        ...peers[socket.id].pipeconsumers,
        consumer.id,
      ]
    }
  }

  const addConsumer = (consumer, roomName) => {
    // add the consumer to the consumers list
    consumers = [
      ...consumers,
      { socketId: socket.id, consumer, roomName, }
    ]

    // add the consumer id to the peers list
    peers[socket.id] = {
      ...peers[socket.id],
      consumers: [
        ...peers[socket.id].consumers,
        consumer.id,
      ]
    }
  }

  socket.on('getProducers', callback => {
    //return all producer transports
    const { roomName } = peers[socket.id]

    let producerList = []
    producers.forEach(producerData => {
      if (producerData.socketId !== socket.id && producerData.roomName === roomName) {
        producerList = [...producerList, producerData.producer.id]
      }
    })

    // return the producer list back to the client
    callback(producerList)
  })

  const informConsumers = (roomName, socketId, id) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`)
    // A new producer just joined
    // let all consumers to consume this producer
    producers.forEach(producerData => {
      if (producerData.socketId !== socketId && producerData.roomName === roomName) {
        const producerSocket = peers[producerData.socketId].socket
        // use socket to send producer id to producer
        producerSocket.emit('new-producer', { producerId: id })
      }
    })
  }

  const getTransport = (socketId) => {
    const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer)
    return producerTransport.transport
  }

  // see client's socket.emit('transport-connect', ...)
  socket.on('transport-connect', ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters })
    
    getTransport(socket.id).connect({ dtlsParameters })
  })

  // see client's socket.emit('transport-produce', ...)
  socket.on('transport-produce', async ({ kind, rtpParameters, appData, OnVM}, callback) => {
    // call produce based on the prameters from the client
    console.log('transport-produce',OnVM)
    const producer = await getTransport(socket.id).produce({
      kind,
      rtpParameters,
    })

    // add producer to the producers array
    const { roomName } = peers[socket.id]

    addProducer(producer, roomName, OnVM)

    // informConsumers(roomName, socket.id, producer.id)

    console.log('Producer ID: ', producer.id, producer.kind)

    producer.on('transportclose', () => {
      console.log('transport for this producer closed ')
      producer.close()
    })

    // Send back to the client the Producer's id
    callback({
      id: producer.id,
      producersExist: producers.length>1 ? true : false
    })
  })

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on('transport-recv-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`)
    const consumerTransport = transports.find(transportData => (
      transportData.consumer && transportData.transport.id == serverConsumerTransportId
    )).transport
    await consumerTransport.connect({ dtlsParameters })
  })

  socket.on('consume', async ({ rtpCapabilities, remoteProducerId, serverConsumerTransportId }, callback) => {
    try {

      const { roomName } = peers[socket.id]
      const router = rooms[roomName].router
      let consumerTransport = transports.find(transportData => (
        transportData.consumer && transportData.transport.id == serverConsumerTransportId
      )).transport

      // check if the router can consume the specified producer
      if (router.canConsume({
        producerId: remoteProducerId,
        rtpCapabilities
      })) {
        // transport can now consume and return a consumer
        const consumer = await consumerTransport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true,
        })

        consumer.on('transportclose', () => {
          console.log('transport close from consumer')
        })

        consumer.on('producerclose', () => {
          console.log('producer of consumer closed')
          socket.emit('producer-closed', { remoteProducerId })

          consumerTransport.close([])
          transports = transports.filter(transportData => transportData.transport.id !== consumerTransport.id)
          consumer.close()
          consumers = consumers.filter(consumerData => consumerData.consumer.id !== consumer.id)
        })

        addConsumer(consumer, roomName)

        // from the consumer extract the following params
        // to send back to the Client
        const params = {
          id: consumer.id,
          producerId: remoteProducerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          serverConsumerId: consumer.id,
        }

        // send the parameters to the client
        callback({ params })
      }
    } catch (error) {
      console.log(error.message)
      callback({
        params: {
          error: error
        }
      })
    }
  })

  socket.on('consumer-resume', async ({ serverConsumerId }) => {
    console.log('consumer resume')
    const { consumer } = consumers.find(consumerData => consumerData.consumer.id === serverConsumerId)
    await consumer.resume()
  })

  socket.on('PipeOut', async(Producer,callback) => {
    const { roomName } = peers[socket.id]
    const router1 = rooms[roomName].router
    let Pipe1
    console.log('PipeOut Dir :',Producer.OnVM,Producer.consumer)
    // redisCli.on('message',async function(channel,msg){
    //   console.log('redis message in',channel)
    //   const message = JSON.parse(msg)
    //   if (channel === 'REQUESTFORPIPING' && message.signature !== AnnouncedIP) {
    //     if (message.type === 'CREATE_PIPE') {
    //       console.log('Incoming message CREATE_PIPE',message)
    //       Pipe1 = await router1.createPipeTransport({
    //         listenIp: 
    //         {
    //           ip: '0.0.0.0', // replace with relevant IP address
    //           announcedIp: AnnouncedIP,
    //         },
    //         enableRtx: true,
    //         enableSrtp: true,
    //       })
    //       addPipe(Pipe1,Pipe1, roomName,Producer.OnVM,Producer.consumer,Pipe1.tuple.localPort)
    //       redisCli.publish('REQUESTFORPIPING', JSON.stringify({
    //         type: 'CREATE_PIPE',
    //         signature: AnnouncedIP,
    //         roomId: roomName,
    //         requestedIp: message.signature
    //       }))
    //     }
    //     if (message.type === 'CONNECT_PIPE') {
    //       console.log('Incoming message CONNECT_PIPE',message)
    //       await Pipe1.connect({
    //           ip: message.remoteIp,
    //           port: message.remotePort,
    //           srtpParameters: message.srtpParameters
    //       })
    //       redisCli.publish('REQUESTFORPIPING', JSON.stringify({
    //           type: 'CONNECT_PIPE',
    //           remoteIp: Pipe1.tuple.localIp,
    //           remotePort: Pipe1.tuple.localPort,
    //           srtpParameters: Pipe1.srtpParameters,
    //           signature: AnnouncedIP,
    //           roomId: roomName,
    //           requestedIp: message.signature
    //       }))
    //     }
    //   }
    // })
    subscription.on(`message`, async(message) => {
      let msg = message.attributes
      let messageCount = 0;
      console.log('message in:',msg.Event,msg.IP,msg.Port)
      const port = parseInt(msg.Port)
      if(msg.Event==='CREATE_PIPE'&&msg.IP!==AnnouncedIP){
        message.ack();
        console.log('Creating Pipe')
        Pipe1 = await router1.createPipeTransport({
          listenIp: 
          {
            ip: '0.0.0.0', // replace with relevant IP address
            announcedIp: AnnouncedIP,
          },
          enableRtx: true,
          enableSrtp: true,
        })
        await delay(1000)
        // console.log('Pipe1',Pipe1.srtpParameters)
        // publishMessage(topicName, "IP & Port",Pipe1.tuple.localPort,'CONNECT_PIPE',Pipe1.srtpParameters);

        publishMessage({
          Topic:topicName, 
          data:"Connect Pipe",
          IP: AnnouncedIP,
          PORT:Pipe1.tuple.localPort.toString(),
          event:'CONNECT_PIPE',
          SRTP : {cryptoSuite:Pipe1.srtpParameters.cryptoSuite,
                  keyBase64:Pipe1.srtpParameters.keyBase64},
          producerId:'undefined'
          });
      }
      if(msg.Event==='CONNECT_PIPE'&&msg.IP!==AnnouncedIP){
        message.ack();
        console.log('Connecting Pipe',Pipe1)
        incoming.IP.push(msg.IP)
        incoming.Port.push(msg.Port)
        if(Pipe1===undefined)
          await delay(1000)
        await Pipe1.connect({ip: msg.IP, port: msg.PORT,srtpParameters:msg.SRTP});
        console.log('connect successful',Pipe1)
        addPipe(Pipe1,Pipe1, roomName,Producer.OnVM,Producer.consumer,Pipe1.tuple.localPort)
        publishMessage({
          Topic:topicName, 
          data:"Consume",
          IP: AnnouncedIP,
          PORT:'Consume',
          event:'canConsume',
          SRTP : 'undefined',
          producerId:Producer.id
          });
        // publishMessage(topicName, "Consume",Pipe1.tuple.localPort,'canConsume',producerId= Producer.id);
      }
      if(msg.Event==='canConsume'&&msg.IP!==AnnouncedIP){
        message.ack();
        console.log('Can Consume',Pipe1);
        Pipe1.consume();
      }
      if(msg.Event==='canProduce'&&msg.IP!==AnnouncedIP){
        message.ack();
        console.log('Disconnecting Pipe',Pipe1);
        Pipe1.produce();
      }
      if(msg.Event==='DISCONNECT_PIPE'&&msg.IP!==AnnouncedIP){
        message.ack();
        console.log('Disconnecting Pipe',Pipe1)
        let index = incoming.IP.indexOf(msg.IP);
        incoming.IP.splice(index, 1);
        index = incoming.Port.indexOf(msg.Port);
        incoming.Port.splice(index, 1);
      }

      messageCount+=1
      console.log('Message:',incoming.IP,',',incoming.Port)
      setTimeout(() => {
        subscription.removeListener('message', messageHandler);
        console.log(`${messageCount} message(s) received.`);
      }, 1 * 1000);
    })
    // console.log(incoming.IP.slice(-1)[0],incoming.Port.slice(-1)[0])
    // await Pipe1.connect({ip: incoming.IP.slice(-1)[0], port: incoming.Port.slice(-1)[0]});
    
    
    

    console.log('Pipe which producer',Producer.id)
    // const PipeID = await From.pipeToRouter({
    //   producerId:Producer.id,
    //   router:To1
    // })


//  console.log('PipeID',PipeID.pipeProducer.id,PipeID.pipeConsumer.id)
    // addPipe('PipeID.pipeProducer','PipeID.pipeConsumer', roomName,Producer.OnVM,Producer.consumer,Pipe1.tuple.localPort)

    // informConsumers(roomName, socket.id, PipeID.pipeProducer.id,Producer.OnRouter,Producer.consumer)
    

    informConsumers(roomName, socket.id, Producer.id)

    callback(Pipe1)
  })
})

const createWebRtcTransport = async (router) => {
  return new Promise(async (resolve, reject) => {
    try {
      // https://mediasoup.org/documentation/v3/mediasoup/api/#WebRtcTransportOptions
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: '0.0.0.0', // replace with relevant IP address
            announcedIp: AnnouncedIP,
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      }

      // https://mediasoup.org/documentation/v3/mediasoup/api/#router-createWebRtcTransport
      let transport = await router.createWebRtcTransport(webRtcTransport_options)
      console.log(`transport id: ${transport.id}`)

      transport.on('dtlsstatechange', dtlsState => {
        if (dtlsState === 'closed') {
          transport.close()
        }
      })

      transport.on('close', () => {
        console.log('transport closed')
      })

      resolve(transport)

    } catch (error) {
      reject(error)
    }
  })
}
function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}