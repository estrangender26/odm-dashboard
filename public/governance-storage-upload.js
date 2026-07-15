(function(global){
  'use strict';
  var MAX_FILE_SIZE=157286400;
  var CHUNK_SIZE=6*1024*1024;
  var RESUME_PREFIX='odm-storage-upload:';

  function jsonResponse(response){
    return response.json().catch(function(){return{};}).then(function(data){
      if(!response.ok)throw new Error(data.error||('Request failed ('+response.status+').'));
      return data;
    });
  }

  function storageEnabled(){
    return fetch('/api/storage/config',{credentials:'same-origin',cache:'no-store'}).then(jsonResponse).then(function(data){
      return !!(data.flags&&data.flags.global&&data.flags.governance);
    });
  }

  function resumeKey(file,target){
    var keys=Object.keys(target).sort();
    var normalized=keys.map(function(key){return[key,target[key]==null?null:target[key]];});
    return RESUME_PREFIX+JSON.stringify(['governance',normalized,file.name,file.type,file.size,file.lastModified]);
  }

  function loadAuthorization(key){
    try{
      var raw=global.localStorage.getItem(key);if(!raw)return null;
      var auth=JSON.parse(raw);
      if(auth.storageEnabled!==true||!auth.intentId||!auth.endpoint||!auth.token||!auth.bucket||!auth.path||new Date(auth.expiresAt).getTime()<=Date.now()+60000){
        global.localStorage.removeItem(key);return null;
      }
      return auth;
    }catch(_error){return null;}
  }

  function saveAuthorization(key,auth){
    try{global.localStorage.setItem(key,JSON.stringify(auth));}catch(_error){}
  }

  function clearAuthorization(key){
    try{global.localStorage.removeItem(key);}catch(_error){}
  }

  function directUpload(file,target,onProgress){
    if(file.size>MAX_FILE_SIZE)return Promise.reject(new Error('Maximum file size is 150 MB.'));
    var key=resumeKey(file,target);
    var cached=loadAuthorization(key);
    var authorization=cached?Promise.resolve(cached):fetch('/api/storage/uploads/authorize',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({module:'governance',originalFilename:file.name,mimeType:file.type||'application/octet-stream',fileSize:file.size,target:target})
      }).then(jsonResponse).then(function(auth){saveAuthorization(key,auth);return auth;});
    return authorization.then(function(auth){
      if(!global.tus||!global.tus.Upload)throw new Error('Resumable upload client is unavailable.');
      return new Promise(function(resolve,reject){
        var upload=new global.tus.Upload(file,{
          endpoint:auth.endpoint,retryDelays:[0,1000,3000,5000,10000,20000],chunkSize:auth.chunkSize||CHUNK_SIZE,
          uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,fingerprint:function(){return Promise.resolve(key+':'+auth.intentId);},headers:{'x-signature':auth.token},
          metadata:{bucketName:auth.bucket,objectName:auth.path,contentType:file.type||'application/octet-stream',cacheControl:'3600',metadata:JSON.stringify({uploadIntentId:auth.intentId})},
          onProgress:function(done,total){if(onProgress)onProgress(total?Math.round(done/total*100):0);},
          onError:function(error){reject(error);},
          onSuccess:function(){
            fetch('/api/storage/uploads/finalize',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({intentId:auth.intentId})})
              .then(jsonResponse).then(function(result){clearAuthorization(key);result.directStorage=true;resolve(result);}).catch(reject);
          }
        });
        upload.findPreviousUploads().then(function(previous){if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start();}).catch(reject);
      });
    });
  }

  global.uploadGovernanceFileWithRollback=function(file,target,legacyUploader,onProgress){
    return storageEnabled().then(function(enabled){return enabled?directUpload(file,target,onProgress):legacyUploader();});
  };

  global.deleteGovernanceFileWithVerification=function(source,id){
    return fetch('/api/storage/files/delete/prepare',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:source,id:id})})
      .then(jsonResponse).then(function(prepared){return fetch('/api/storage/files/delete/confirm',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmationToken:prepared.confirmationToken})}).then(jsonResponse);});
  };
})(window);
