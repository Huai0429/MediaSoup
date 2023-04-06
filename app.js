//server side
import express from 'express'
const app = express()

import https from 'httpolyglot'
import fs from 'fs'
import path from 'path'
const __dirname = path.resolve()

import {Server} from 'socket.io'
import mediasoup from 'mediasoup'
import { SocketAddress } from 'net'
import e from 'express'
import { send } from 'process'
import { resolveObjectURL } from 'buffer'
import { randomFillSync } from 'crypto'
import { Console, profile } from 'console'

const host_ip = "140.118.107.177"
const rev_ip = "0.0.0.0"
let worker 
let consumer
let producer
let router 
let router2
let producerTransport
let consumerTransport
let RProducerTransport
let RConsumerTransport


app.get('/',(req,res)=>{
    res.send('Hello from mediasoup app')
})

app.use('/sfu',express.static(path.join(__dirname,'public')))

const options = {
    key: fs.readFileSync('./server/ssl/key.pem','utf-8'),
    cert: fs.readFileSync('./server/ssl/cert.pem','utf-8')

}

const  httpsServer = https.createServer(options,app)
httpsServer.listen(3000,() => {
    console.log('listening on port: '+3000)
})

const io = new Server(httpsServer)

const peers = io.of('/mediasoup')




//worker 


//worker's RTCport
const  createWorker = async()=>{
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    })
    console.log(`worker pid ${worker.pid}`)

    worker.on('died',error => {
        console.error('mediasoup worker has died')
        setTimeout(()=> process.exit(1),2000)//exit in 2 sec
    })
    return worker
}
worker = createWorker()

const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate:48000,
        channels:2,
    },
    {
        kind:'video',
        mimeType:'video/VP8',
        clockRate:90000,
        parameters:{
            'x-google-start-bitrate':1000,
        },
    },
]

//router

//client connect & disconnect
peers.on('connection' , async socket => { //'connection' event on peers
    console.log('"Connection" Event from app.js'),
    console.log(socket.id)
    socket.emit('connection-success',{ //emit back 'connection-success' link to index.js
        socketId: socket.id,
        existsProducer: producer ? true : false,
    })

    socket.on('disconnect',()=>{
        //do some clean up
        console.log('peer disconnect')
    })
    

    socket.on('CreateRoom',async(callback)=>{
        if (router === undefined){
            router = await worker.createRouter({mediaCodecs,})
            console.log(`Router ID: ${router.id}`)
        }
        if (router2 === undefined){
            router2 = await worker.createRouter({mediaCodecs,})
            console.log(`Router2 ID: ${router2.id}`)
        }
        getRtpCapabilities(callback)
    })

    const getRtpCapabilities=(callback)=>{
        const rtpCapabilities = router.rtpCapabilities
        const rtpCapabilities2 = router2.rtpCapabilities
        callback({rtpCapabilities,rtpCapabilities2})// call back for emit in index.js
    }

    // call from 'const getRtpCapabilities' from index.js
    // socket.on('getRtpCapabilities',(callback)=>{  

    //     const rtpCapabilities = router.rtpCapabilities
    //     console.log('"getRtpCapabilities" Event from app.js')
    //     // console.log(`rtp Capabilities${rtpCapabilities.codecs}`)

    //     callback({rtpCapabilities}) // call back for emit in index.js 
    // })

    //call from const createSendTransport (button 3)
    socket.on('createWebRtcTransport',async ({sender,pipesender},callback)=>{
        console.log(`Is this a sender request? ${sender}`)
        if(sender)
            producerTransport = await createWebRtcTransport(callback,true)
        else 
            consumerTransport = await createWebRtcTransport(callback,true)
        if(pipesender){
            RConsumerTransport = await createWebRtcTransport(callback,false)
        }else{
            RProducerTransport = await createWebRtcTransport(callback,false)
        }
    })

    socket.on('transport-connect',async({dtlsParameters})=>{
        console.log('DTLS PARAMS...',[dtlsParameters])
        await producerTransport.connect({dtlsParameters})
    })

    socket.on('transport-produce',async({kind,rtpParameters,appData},callback)=>{
        producer = await producerTransport.produce({
            kind,
            rtpParameters,    
        })

        console.log('Producer ID: ',producer.id,producer.kind)
        producer.on('transportclose',()=>{
            console.log('transport for this producer closed ')
            producer.close()
        })
        callback({
            id : producer.id
        })
    })
    socket.on('transport-recv-connect',async({dtlsParameters})=>{
        console.log(`DTLS PARAMS:${dtlsParameters}`)
        await consumerTransport.connect({dtlsParameters})
    })
    socket.on('consume',async({rtpCapabilities},callback)=>{
        try{
            console.log(`consume in app.js ${producer.id}`)
            // console.log(`${producer.id}`)
            if(router.canConsume({
                producerId:producer.id,
                rtpCapabilities,
            })){
                consumer = await consumerTransport.consume({
                    producerId:producer.id,
                    rtpCapabilities,
                    paused:true,
                })
                consumer.on('transportclose',()=>{
                    console.log('transport close from consumer')
                })
                consumer.on('producerclose',()=>{
                    console.log('producer of consumer closed')
                })
                const params = {
                    id:consumer.id,
                    producerId:producer.id,
                    kind:consumer.kind,
                    rtpParameters:consumer.rtpParameters,
                }

                callback({params}) //because callback on index.js is an object
            }

        }catch(error){
            // console.log(`producer ID : ${producer.id}`)
            console.log(error.message)
            callback({
                params:{
                    error:error
                }
            })
        }
    })
    socket.on('consumer-resume',async ()=>{//restart consumer's stream stop by 150 lines
        console.log('consumer resume')
        await consumer.resume()
    })
})



//producer transport
let transport
let transport2
//createWebRtcTransport
const createWebRtcTransport = async(callback,mode)=>{
    try {
        const webRtcTransport_options = {
            listenIps:[
                {
                    ip:rev_ip,//replace by relevant IP address
                    announcedIp: host_ip,//host machine IP
                }
            ],
            enableUdp:true,
            enableTcp:true,
            preferUdp:true,
        }
        
        if(mode){
            transport = await router.createWebRtcTransport(webRtcTransport_options)
            console.log(`Create WebRtc Transport id: ${transport.id} on router`)
        }
        else{
            transport2 = await router2.createWebRtcTransport(webRtcTransport_options)
            console.log(`Create WebRtc Transport id: ${transport2.id} on router2`)
        }
        transport.on('dtlsstatechange',dtlsState=>{
            if(dtlsState=='closed'){
                transport.close()
            }
        })

        transport.on('close',()=>{
            console.log('transport closed')
        })
        // console.log(`${transport.id}`)
        if(!mode){
            callback({
                params:{
                    id: transport.id,
                    id2: transport2.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters,
                }
            })
        }
        
        return transport
    }catch(error){
        console.log('CreateWebRtcTransport wrong')
        console.log(error)
        callback({
            params:{
                error:error
            }
        })
    }
}
const createPipeTransport = async(callback)=>{
    try{
        const PipeTransport_options = {
            listenIp:[
                {
                    ip:"0.0.0.0",//replace by relevant IP address
                    announcedIp: host_ip,//host machine IP
                }
            ],
            enableSctp:true,
            enableRtx:true,
            enableSrtp:true,
        }
        let pipetransport = await router2.createPipeTransport(PipeTransport_options)
        console.log(`Create Pipe transport ${pipetransport.id}`)
        return pipetransport
    }catch(error){
        console.log('createPipeTransport got error')
        console.log(error)
        callback({
            params:{
                error:error
            }
        })
    }
}