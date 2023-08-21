/**
 * integrating mediasoup server with a node.js application
 */

/* Please follow mediasoup installation requirements */
/* https://mediasoup.org/documentation/v3/mediasoup/installation/ */
import express from 'express'
const app = express()
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
let Pipetransports = []
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
const pub = new PubSub();
const sub = new PubSub();
const flowControl = {
  setMaxOutreadyElementCount: 5,
  maxExtensionMinutes: 1,
}
const subscription = sub.subscription(subscriptionName,{ flowControl: flowControl });

async function publishMessage(customAttributes) {
  const dataBuffer = Buffer.from(customAttributes.data);
  const publishOptions = {
    setMaxOutreadyElementCount: 5,
    messageOrdering: true,
  };
  console.log('Message Out: ',customAttributes.event,customAttributes.IP,customAttributes.Dir)
  const messageId = await pub.topic(customAttributes.Topic,publishOptions).publishMessage({data: dataBuffer, attributes: customAttributes})
  console.log(`Message ${messageId} published.`);
}

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
      console.log('peer can be disconnected',socket.id)
      publishMessage({
        Topic:topicName, 
        data:"IP & Port",
        IP: AnnouncedIP,
        socketID:socket.id,
        event:'DISCONNECT_PIPE',
      });
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
    if(Object.keys(peers).length>=1){
      publishMessage({
        Topic:topicName, 
        data:"Create pipe transport",
        IP: AnnouncedIP,
        event:'CREATE_PIPE',
        Dir:'12',
        orderingKey:'7',
      });
    }
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
    // get Router RTP Capabilities
    const rtpCapabilities = router1.rtpCapabilities
    console.log('joinRoom')
    // call callback from the client and send back the rtpCapabilities
    callback({ rtpCapabilities })
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
  socket.on('createWebRtcTransport', async ({ consumer}, callback) => {
    const roomName = peers[socket.id].roomName
    const router = rooms[roomName].router
    console.log('createWebRtcTransport for consumer',consumer)

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
        addTransport(transport, roomName, consumer, false)
      },
      error => {
        console.log(error)
      })
  })

  const addTransport = (transport, roomName, consumer) => {
    if(transport.appData.forPipe){
      Pipetransports = [
        ...Pipetransports,
        { socketId: socket.id, transport, roomName,appData:transport.appData,consumer}
      ]
    }else{
      transports = [
        ...transports,
        { socketId: socket.id, transport, roomName, consumer}
      ]

      peers[socket.id] = {
        ...peers[socket.id],
        transports: [
          ...peers[socket.id].transports,
          transport.id,
        ]
      }
    }
  }

  const addProducer = (producer, roomName) => {
    producers = [
      ...producers,
      { socketId: socket.id, producer, roomName}
    ]

    peers[socket.id] = {
      ...peers[socket.id],
      producers: [
        ...peers[socket.id].producers,
        producer.id,
      ],
      OnVM_P: [
        ...peers[socket.id].OnVM_P,
      ]
    }
  }

  const addPipe = (producer,consumer, roomName,site,Dir,Port,socketID) => {
    pipeproducers = [
      ...pipeproducers,
      { socketId: socketID, producer, roomName, site, Dir,Port}
    ]
    pipeconsumers = [
      ...pipeconsumers,
      { socketId: socketID, consumer, roomName, site, Dir,Port}
    ]

    if(producer===undefined){
      peers[socket.id] = {
        ...peers[socket.id],
        pipeconsumers: [
          ...peers[socket.id].pipeconsumers,
          consumer.id,
        ]
      }
    }
    if(consumer===undefined){
      peers[socket.id] = {
        ...peers[socket.id],
        pipeproducers: [
          ...peers[socket.id].pipeproducers,
          producer.id,
        ],
      }
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

  const informConsumers = (roomName, socketId, id,PipeorNot) => {
    console.log(`just joined, id ${id} ${roomName}, ${socketId}`)
    // A new producer just joined
    // let all consumers to consume this producer
    if(PipeorNot===true){
      pipeproducers.forEach(producerData => {
        if (producerData.socketId !== socketId && producerData.roomName === roomName) {
          const producerSocket = socket
          // use socket to send producer id to producer
          producerSocket.emit('new-producer', { producerId: id })
        }
      })
    }else{
      producers.forEach(producerData => {
        if (producerData.socketId !== socketId && producerData.roomName === roomName) {
          const producerSocket = peers[producerData.socketId].socket
          // use socket to send producer id to producer
          producerSocket.emit('new-producer', { producerId: id })
        }
      })
    }
    
  }

  const getTransport = (socketId,ForPipe,Dir) => {
    if(ForPipe){
      const [pipetransport] = Pipetransports.filter((transport) => {
        if(transport.appData.Dir === Dir&& !transport.appData.Connect){
          transport.appData.Connect = true
          return transport
        }
      });
      return pipetransport.transport
    }else{
      const [producerTransport] = transports.filter(transport => transport.socketId === socketId && !transport.consumer)
      return producerTransport.transport
    }
  }

  // see client's socket.emit('transport-connect', ...)
  socket.on('transport-connect', ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters })
    
    getTransport(socket.id,false).connect({ dtlsParameters })
  })

  // see client's socket.emit('transport-produce', ...)
  socket.on('transport-produce', async ({ kind, rtpParameters, appData}, callback) => {
    // call produce based on the prameters from the client
    console.log('transport-produce')
    const producer = await getTransport(socket.id,false).produce({
      kind,
      rtpParameters,
    })

    // add producer to the producers array
    const { roomName } = peers[socket.id]

    addProducer(producer, roomName)

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
    let Pipe1ID,Pipe2ID
    let pipeconsumer1,pipeproducer1
    let pipeconsumer2,pipeproducer2
    console.log('PipeOut Dir :',Producer.consumer)
    subscription.on(`message`, async(message) => {
      let msg = message.attributes
      let messageCount = 0;
      console.log('message in:',msg.event,msg.IP,msg.Dir,message.id)
      if(msg.event==='CREATE_PIPE'&&msg.IP!==AnnouncedIP){
        message.ack();
        console.log('Creating Pipe',msg.Dir)
        CreatePipeTranports(msg.Dir).then(
          transport => {
            // add transport to Peer's properties
            if(msg.Dir === '21'){
              addTransport(transport, roomName, true)
              Pipe1ID = transport.id
              publishMessage({
                Topic:topicName, 
                data:"Create pipe transport",
                IP: AnnouncedIP,
                event:'CREATE_PIPE',
                Dir:'21',
                orderingKey:'2',
              });
            }else{
              addTransport(transport, roomName, false)
              Pipe2ID = transport.id
              publishMessage({
                Topic:topicName, 
                data:"Connect Pipe",
                IP: AnnouncedIP,
                PORT:transport.tuple.localPort.toString(),
                event:'CONNECT_PIPE',
                SRTP_cryptoSuite :transport.srtpParameters.cryptoSuite,
                SRTP_keyBase64: transport.srtpParameters.keyBase64,
                Dir:'12',
                orderingKey:'9',
              });
            }
            
          },
          error => {
            console.log(error)
          })
      }
      if(msg.event==='CONNECT_PIPE'&&msg.IP!==AnnouncedIP){
        message.ack();
        const port = parseInt(msg.PORT)
        if(msg.Dir === '21'){
          const transport = getTransport(socket.id,true,msg.Dir)
          console.log('connecting Pipe1')
          await transport.connect({ip: msg.IP, port: port,srtpParameters:{cryptoSuite:msg.SRTP_cryptoSuite,keyBase64:msg.SRTP_keyBase64}});
          publishMessage({
            Topic:topicName, 
            data:"Connect Pipe",
            IP: AnnouncedIP,
            PORT:transport.tuple.localPort.toString(),
            event:'CONNECT_PIPE',
            SRTP_cryptoSuite :transport.srtpParameters.cryptoSuite,
            SRTP_keyBase64: transport.srtpParameters.keyBase64,
            Dir:'21',
            orderingKey:'4',
          });
        }
        else{
          const transport = getTransport(socket.id,true,msg.Dir)
          console.log('connecting Pipe2')
          await transport.connect({ip: msg.IP, port: port,srtpParameters:{cryptoSuite:msg.SRTP_cryptoSuite,keyBase64:msg.SRTP_keyBase64}});
          publishMessage({
            Topic:topicName, 
            data:"can Produce",
            IP: AnnouncedIP,
            event:'PIPE_PRODUCE',
            producerId:Producer.id,
            Dir:'12',
            orderingKey:'11',
          });
        }
      }
      if(msg.event==='PIPE_CONSUME'&&msg.IP!==AnnouncedIP){
        message.ack();
        if(msg.Dir==='21'){
          let pipetransport = Pipetransports.find(transports => (
            !transports.consumer &&transports.transport.id === Pipe1ID
          )).transport
          pipeproducer1 = await pipetransport.produce({
            kind:'video',
            rtpParameters:JSON.parse(msg.data),
          })
        }else{
          let pipetransport = Pipetransports.find(transports => (
            !transports.consumer &&transports.transport.id === Pipe2ID
          )).transport
          pipeproducer2 = await pipetransport.produce({
            kind:'video',
            rtpParameters:JSON.parse(msg.data),
          })
        }
        
        // pipeproducer.resume()
        if(msg.Dir==='21'){
          addPipe(pipeproducer1,pipeconsumer1, roomName,Producer.consumer,incoming.Port.slice(-1)[0],msg.socketID)
          console.log('PIPE_CONSUME',pipeproducer1.id)
          informConsumers(roomName, socket.id, pipeproducer1.id,true)
        }else{
          addPipe(pipeproducer2,pipeconsumer2, roomName,Producer.consumer,incoming.Port.slice(-1)[0],msg.socketID)
          console.log('PIPE_CONSUME',pipeproducer2.id)
          informConsumers(roomName, socket.id, pipeproducer2.id,true)
        }
      }
      if(msg.event==='PIPE_PRODUCE'&&msg.IP!==AnnouncedIP){
        message.ack();
        const rtpCapabilities = router1.rtpCapabilities
        console.log('PIPE_PRODUCE Event');
        try {
          if(msg.Dir==='21'){
            let pipetransport = Pipetransports.find(transports => (
              transports.consumer &&transports.transport.id === Pipe1ID
            )).transport
            pipeconsumer1 = await pipetransport.consume({
              producerId: Producer.id,
              rtpCapabilities,
              kind: 'video',
              paused: true
            })
          }else{
            let pipetransport = Pipetransports.find(transports => (
              transports.consumer && transports.transport.id === Pipe2ID
            )).transport
            pipeconsumer2 = await pipetransport.consume({
              producerId: Producer.id,
              rtpCapabilities,
              kind: 'video',
              paused: true
            })
          }
        } catch (error) {
            console.error('video consume failed', error,msg.Dir)
            return
        }
        publishMessage({
          Topic:topicName, 
          data:msg.Dir==='21'?JSON.stringify(pipeconsumer1.rtpParameters):JSON.stringify(pipeconsumer2.rtpParameters),
          IP: AnnouncedIP,
          event:'PIPE_CONSUME',
          socketID: socket.id,
          producerId:Producer.id,
          Dir:msg.Dir==='21'?'21':'12',
          orderingKey:'6',
        });
        publishMessage({
          Topic:topicName, 
          data:"Create pipe transport",
          IP: AnnouncedIP,
          event:'CREATE_PIPE',
          Dir:'12',
          orderingKey:'7',
        });
      }
      if(msg.event==='DISCONNECT_PIPE'&&msg.IP!==AnnouncedIP){
        message.ack();
        console.log('Remote Disconnecting',msg.socketID)
        pipeproducers.forEach(item => { 
          if(item.socketId===msg.socketID){
            let index = incoming.Port.indexOf(item.Port);
            console.log('Port :',item.Port[index],'disconnect')
            incoming.Port.splice(index, 1);
          }
        })
        pipeproducers = removeItems(pipeproducers, msg.socketID, 'producer')
        pipeconsumers = removeItems(pipeconsumers, msg.socketID, 'consumer')
      }

      messageCount+=1
      console.log('Message:',incoming.IP,',',incoming.Port)
      setTimeout(() => {
        // subscription.removeListener('message', messageHandler);
        console.log(`${messageCount} message(s) received.`);
      }, 1 * 1000);
    })
    const CreatePipeTranports = async(Dir)=> {
      return new Promise(async (resolve, reject) => {
        try{
          let Pipe = await router1.createPipeTransport({
            listenIp: 
            {
              ip: '0.0.0.0', // replace with relevant IP address
              announcedIp: AnnouncedIP,
            },
            enableRtx: true,
            enableSrtp: true,
          })
          Pipe.appData['forPipe']=true
          Pipe.appData['Connect']=false
          Pipe.appData['Dir']=Dir
          console.log("transport ",Pipe.id)
          console.log("Tuple ",Pipe.tuple)
          console.log("appData ",Pipe.appData)
          Pipe.on('dtlsstatechange', dtlsState => {
            if (dtlsState === 'closed') {
              Pipe.close()
            }
          })
    
          Pipe.on('close', () => {
            console.log('transport closed')
          })
    
          resolve(Pipe)
        }catch (error) {
          reject(error)
        }
      })
      
    }
    informConsumers(roomName, socket.id, Producer.id,false)
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