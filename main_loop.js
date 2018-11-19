
// KEY='' BUFFER_CONTRACT='' WEB3_URL='ws://94.130.94.163:8546' MYSQL_HOST='localhost' MYSQL_USER='' MYSQL_PASSWORD='' MYSQL_DATABASE='miranode'
const myKey = process.env.KEY;
var buffer_contract = process.env.BUFFER_CONTRACT;
const WEB3_URL= process.env.WEB3_URL || 'ws://localhost:8546';


const buffer_contract_src = require('mira-box-farm-contracts/build/contracts/Buffer.json');
const mirabox_contract_src = require('mira-box-farm-contracts/build/contracts/TwoFactor.json');
const buffer_abi = buffer_contract_src.abi;
const abiMiraKey=  mirabox_contract_src.abi;




if(!myKey) {
  throw (new Error('You need to setup KEY environment variable'));
}

if(!buffer_contract) {
    // throw (new Error('You need to setup BUFFER_CONTRACT environment variable'));
    buffer_contract = buffer_contract_src.networks['43'].address;
}
console.log("You buffer contract address is:", buffer_contract);



var mysql = require('promise-mysql');
const Web3 =require( 'web3');
var bitcore = require('bitcore-lib');
var sjcl = require('sjcl-all');



const public1 = new bitcore.PrivateKey(bitcore.crypto.BN.fromString(myKey,'hex')).toPublicKey().toObject();
public1.compressed = false;
console.log("My public key:", new bitcore.PublicKey(public1).toString());
var w3= new Web3(WEB3_URL);
console.log("My network address=",w3.eth.accounts.privateKeyToAccount("0x"+myKey).address);

const MAX_KEYS = 100;

var txcount =0 ;


var bufferContract = new w3.eth.Contract(buffer_abi, buffer_contract);


var conn;



function openBox(contract_address,miraKeyContract,publ,secret) {

    miraKeyContract.getPastEvents('PrivateKey',{ fromBlock: 0 })
        .then((events) => {
            if(events.length > 0) {
                console.log("private key already published");
                conn.query({sql: 'update ecckeys set opened=true where `pub` = ?',values: [publ]})
                    .then(() => console.log("pub key="+publ+" set to opened in database"))
                    .catch(() => console.error);
                return;
            }
            miraKeyContract.methods.receiver().call()
                .then((receiver) =>{
                try {
                    console.log("Receiver:", receiver);
                    var pub = new sjcl.ecc.elGamal.publicKey(
                        sjcl.ecc.curves.k256,
                        sjcl.codec.hex.toBits(receiver.slice(2))
                    );

                    var encoded = sjcl.encrypt(pub, secret);
                    console.log("Encoded private key:", encoded);
                    var encoded_abi = miraKeyContract.methods.publishPrivateKey(encoded).encodeABI();

                    w3.eth.accounts.signTransaction({
                        to: contract_address,
                        value: Web3.utils.toWei('0'),
                        gas: 220000,
                        gasPrice: '1',
                        data: encoded_abi,
                        nonce: txcount++

                    }, '0x' + myKey)
                        .then((tx) => w3.eth.sendSignedTransaction(tx.rawTransaction))
                        .then((tx2) => {
                            conn.query({sql: 'update ecckeys set opened=true where `pub` = ?', values: [publ]})
                                .then(() => console.log("pub key=" + publ + " set to opened in database"))
                                .catch(() => console.error);
                            console.log("Transaction=" + tx2.transactionHash + " for put private key to contract=" + contract_address + " sent.");
                        })
                        .catch(console.error);
                } catch (e) {
                    conn.query({sql: 'update ecckeys set opened=true where `pub` = ?', values: [publ]})
                        .then(() => console.log("pub key=" + publ + " set to opened in database"))
                        .catch(() => console.error);
                    throw (e);
                }
                })
                .catch(console.error)
            ;
        });

}


function addKeyOpenCallback(contract_address,pub,secret) {

    var miraKeyContract = new w3.eth.Contract(abiMiraKey, contract_address);

    // Open mirabox
    w3.eth.getBlockNumber()
        .then((block) => {
            miraKeyContract.getPastEvents('Open',{fromBlock: 0, toBlock: block})
                .then((eventlist) => {
                    if(eventlist.length>0) {
                        console.log("Contract="+ contract_address +" in already opened state");
                        return eventlist[0];
                    }
                    return new Promise(function(resolve, reject) {
                        miraKeyContract.once('Open',{'fromBlock': block+1},(err, event) =>{
                            if (err) {
                                return reject(err)
                            }
                            return resolve(event);
                        })
                    })
                })
                .then((event) =>{
                    console.log("Contract "+contract_address+" opened");
                    openBox(contract_address,miraKeyContract,pub,secret);
                });
        });
}



function addNewKey() {

        var privateKey = new bitcore.PrivateKey();
        var publicKey = bitcore.PublicKey(privateKey);
        console.log("new keypair generated secret=",privateKey.toString(), " pub=", publicKey.toString()); /// !!!!
        conn.query({
            sql: 'insert into `buffer` (`pub`,`secret`) values ( ?,? ) ',
            values: [publicKey.toString(), privateKey.toString()]
        })
            .then(() => {
                console.log("pub key="+publicKey.toString()+" with private key inserted into buffer table");
                var encoded_abi = bufferContract.methods.addKey(publicKey.toString()).encodeABI();
                // console.log("Start sign transaction");
                return w3.eth.accounts.signTransaction({
                    to: buffer_contract,
                    value: Web3.utils.toWei('0'),
                    gas: 220000,
                    gasPrice: '3',
                    data: encoded_abi,
                    nonce: txcount++,
                }, '0x' + myKey);
            })
            .then((tx) => {
                console.log("Signed transaction:", tx.rawTransaction);
                return w3.eth.sendSignedTransaction(tx.rawTransaction);
            })
            .then((tx) => {
                console.log("Tx sent:", tx.transactionHash);
                // console.log("query:", 'update `buffer` set `contract`="'+buffer_contract +'" where `pub`="'+publicKey.toString() +'"');
                return conn.query('update `buffer` set `contract`="'+buffer_contract +'" where `pub`="'+publicKey.toString() +'"')
                    .then(() => console.log(publicKey.toString()+ ' set contract address'))
                    .catch(console.error);
            })
            .then(() => console.log("Key=" + publicKey.toString() + ' saved to contract=' + buffer_contract))
            .catch(console.error);

}

// LOCK TABLE data_buffer READ;
// INSERT INTO data SELECT * FROM data_buffer;
// DELETE FROM data_buffer;
// UNLOCK TABLE;

async  function PublicKeyControlChange(pkey,contr) {
        console.log("Withdraw public key=",pkey," from contract=",contr);
        conn.getConnection().then(function(connection) {
            connection.query({
                sql: "INSERT INTO `ecckeys` (`pub`,`secret`,`contract`)  SELECT `pub`,`secret`,? FROM `buffer` where `pub`=?",
                values: [contr, pkey]
            })
                .then(()=>connection.query({
                    sql: "DELETE FROM `buffer` where `pub`=?",
                    values: [pkey]
                }))
                .then(() => connection.query({
                    sql:'SELECT * from `ecckeys` where `pub`=? and `contract`=?',
                    values: [pkey,contr]
                }))
                .then(rows => {
                    // console.log("New callback sql result:",rows);
                    rows.forEach((row) => {
                        console.log("New callback for:",row.pub);
                        if (!row.contract) {throw "No contract for key "+ row.pub; }
                        addKeyOpenCallback(row.contract,row.pub,row.secret);
                    });
                })
                .catch(console.error)
        });
}








// function  handleDisconnect() {
//     conn = mysql.createConnection({
//
//         host: process.env.MYSQL_HOST || 'localhost',
//         user: process.env.MYSQL_USER || 'root',
//         password: process.env.MYSQL_PASSWORD || '',
//         database: process.env.MYSQL_DATABASE || 'miranode'
//     }); // Recreate the connection, since
//                                                     // the old one cannot be reused.
//                                             // If you're also serving http, display a 503 error.
//     conn.on('error', function(err) {
//         console.log('db error ', err);
//         if(err.code === 'PROTOCOL_CONNECTION_LOST') { // Connection to the MySQL server is usually
//             setTimeout(handleDisconnect, 2000);       // lost due to either server restart, or a
//         } else {                                      // connnection idle timeout (the wait_timeout
//             throw err;                                  // server variable configures this)
//         }
//     });
//
//     return conn;
// }



async function main() {




    // conn = await handleDisconnect();
    conn = mysql.createPool({
        host: process.env.MYSQL_HOST || 'localhost',
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'miranode',
        connectionLimit: 10
    });


    txcount = await new Promise (function (resolve, reject) {
        w3.eth.getTransactionCount(w3.eth.accounts.privateKeyToAccount("0x"+myKey).address,
            function (err, cnt) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(cnt);
            }
        );
    });
    console.log("Nonce for my address=",txcount);


    var r = await conn.query('select * from ecckeys where opened=false')
        .then((rows) => {rows.forEach((row) => {
            console.log("addKeyOpenCallback:",row.pub);

            if (!row.contract) {throw "No contract for key "+ row.pub; }
            addKeyOpenCallback(row.contract,row.pub,row.secret);

        })
    });




    var keysInBuffer = await new Promise (function (resolve, reject) {
        bufferContract.methods.keysCount().call(
            function (err, cnt) {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(cnt);
            }
        )
    });

    console.log("NumKeys in buffer=",keysInBuffer);






    // bufferContract.events.PublicKeyControlChange({'fromBlock': 0},function(error, event){
    //      console.log( "Event PublicKeyControlChange("+event.returnValues.publicKey+","+event.returnValues.contractAddress+")");
    //
    //     // console.log( event);
    //     (function(pkey,contr) {
    //         console.log("Withdraw public key=",pkey," from contract=",contr);
    //
    //         return conn.beginTransaction()
    //             .then(()=>conn.query(
    //                 {
    //                     sql: "INSERT INTO `ecckeys` (`pub`,`secret`,`contract`)  SELECT `pub`,`secret`,? FROM `buffer` where `pub`=?",
    //                     values: [contr, pkey]
    //                 }))
    //             .then(()=>conn.query({
    //                 sql: "DELETE FROM `buffer` where `pub`=?",
    //                 values: [pkey]
    //             }))
    //             .then(()=>conn.commit())
    //             .then(() => conn.query({
    //                 sql:'SELECT * from `ecckeys` where `pub`=? and `contract`=?',
    //                 values: [pkey,contr]
    //             }))
    //             .then(rows => {
    //                 // console.log("New callback sql result:",rows);
    //
    //
    //                 rows.forEach((row) => {
    //                     console.log("New callback for:",row.pub);
    //                     if (!row.contract) {throw "No contract for key "+ row.pub; }
    //                     addKeyOpenCallback(row.contract,row.pub,row.secret);
    //
    //                     });
    //                 addNewKey();
    //
    //             })
    //             .catch(console.error)
    //     })(event.returnValues.publicKey,event.returnValues.contractAddress)
    //         .then(console.log("Key moved from buffer: ",event.returnValues.publicKey))
    //         .catch(console.error);
    // });





    w3.eth.getBlockNumber()
        .then((block) => {

            bufferContract.events.PublicKeyControlChange({'fromBlock': block+1},function(error, event){
                if (error) {
                    console.error(error);
                    return;
                }
                    PublicKeyControlChange(event.returnValues.publicKey,event.returnValues.contractAddress)
                        .then(()=> {
                            console.log("Key moved from buffer: ",event.returnValues.publicKey);
                            addNewKey();
                        })
                        .catch(console.error);
                });


            bufferContract.getPastEvents('PublicKeyControlChange',{fromBlock: 0, toBlock: block})
                .then((eventlist) => {
                    if(eventlist.length>0) {
                        // check if not missed opened keys

                        eventlist.forEach((event) => {

                            conn.query({
                                sql: "SELECT count(*) as c FROM `buffer` where `pub`=?",
                                values: [event.returnValues.publicKey]
                            }).then(rows=>{
                                if (rows[0].c>0 ) {


                                console.log("Found inconsistencie in sql table `buffer` for pub="+event.returnValues.publicKey);
                                PublicKeyControlChange(event.returnValues.publicKey,event.returnValues.contractAddress)
                                    .then(()=> {
                                        console.log("Key moved from buffer: ",event.returnValues.publicKey);
                                        addNewKey();
                                    })
                                    .catch(console.error);

                            }})

                        })
                    }
                });



        });




    // push keys to buffer
    for (var i = keysInBuffer; i < MAX_KEYS; i++) {
        addNewKey();
    }



}

main().then(()=> console.log("Software finished."));