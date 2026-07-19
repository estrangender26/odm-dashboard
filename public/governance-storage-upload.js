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
      // Note: capabilityToken is intentionally NOT persisted in localStorage
      return auth;
    }catch(_error){return null;}
  }

  function saveAuthorization(key,auth){
    // Save authorization without capabilityToken (never persist sensitive tokens)
    var authWithoutToken=Object.assign({},auth);
    delete authWithoutToken.capabilityToken;
    try{global.localStorage.setItem(key,JSON.stringify(authWithoutToken));}catch(_error){}
  }

  function clearAuthorization(key){
    try{global.localStorage.removeItem(key);}catch(_error){}
  }

  function refreshAuthorization(auth){
    // Send capabilityToken for anonymous resume
    var body={intentId:auth.intentId};
    if(auth.capabilityToken){
      body.capabilityToken=auth.capabilityToken;
    }
    return fetch('/api/storage/uploads/resume',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(jsonResponse);
  }

  function abandonAuthorization(intentId,capabilityToken){
    // Send capabilityToken for anonymous abandon
    var body={intentId:intentId};
    if(capabilityToken){
      body.capabilityToken=capabilityToken;
    }
    return fetch('/api/storage/uploads/abandon',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(function(){});
  }

  function abortError(signal){
    return signal&&signal.reason instanceof Error?signal.reason:new DOMException('Upload aborted.','AbortError');
  }

  function directUpload(file,target,onProgress,signal){
    if(signal&&signal.aborted)return Promise.reject(abortError(signal));
    if(file.size>MAX_FILE_SIZE)return Promise.reject(new Error('Maximum file size is 150 MB.'));
    var key=resumeKey(file,target);
    var cached=loadAuthorization(key);
    // Keep capabilityToken in memory only (not from localStorage)
    var memoryCapabilityToken=null;
    var authorization=(cached?refreshAuthorization(cached).then(function(auth){
      // Store capabilityToken in memory only
      memoryCapabilityToken=auth.capabilityToken||null;
      saveAuthorization(key,auth);return auth;
    }).catch(function(){clearAuthorization(key);return null;}):Promise.resolve(null)).then(function(auth){
      if(auth)return auth;
      return fetch('/api/storage/uploads/authorize',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({module:'governance',originalFilename:file.name,mimeType:file.type||'application/octet-stream',fileSize:file.size,target:target})
      }).then(jsonResponse).then(function(newAuth){
        // Store capabilityToken in memory only
        memoryCapabilityToken=newAuth.capabilityToken||null;
        saveAuthorization(key,newAuth);return newAuth;
      });
    });
    return authorization.then(function(auth){
      if(!global.tus||!global.tus.Upload)throw new Error('Resumable upload client is unavailable.');
      return new Promise(function(resolve,reject){
        var settled=false;
        function cleanup(){if(signal)signal.removeEventListener('abort',onAbort);}
        function fail(error){if(settled)return;settled=true;cleanup();reject(error);}
        function succeed(result){if(settled)return;settled=true;cleanup();resolve(result);}
        var upload=new global.tus.Upload(file,{
          endpoint:auth.endpoint,retryDelays:[0,1000,3000,5000,10000,20000],chunkSize:auth.chunkSize||CHUNK_SIZE,
          uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,fingerprint:function(){return Promise.resolve(key+':'+auth.intentId);},headers:{'x-signature':auth.token},
          metadata:{bucketName:auth.bucket,objectName:auth.path,contentType:file.type||'application/octet-stream',cacheControl:'3600',metadata:JSON.stringify({uploadIntentId:auth.intentId})},
          onProgress:function(done,total){if(onProgress)onProgress(total?Math.round(done/total*100):0);},
          onError:fail,
          onSuccess:function(){
            cleanup();
            // Send capabilityToken for anonymous finalize
            var finalizeBody={intentId:auth.intentId};
            if(memoryCapabilityToken){
              finalizeBody.capabilityToken=memoryCapabilityToken;
            }
            fetch('/api/storage/uploads/finalize',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(finalizeBody)})
              .then(jsonResponse).then(function(result){clearAuthorization(key);result.directStorage=true;succeed(result);}).catch(fail);
          }
        });
        function onAbort(){
          if(settled||!signal)return;settled=true;cleanup();clearAuthorization(key);abandonAuthorization(auth.intentId,memoryCapabilityToken);
          Promise.resolve(upload.abort()).catch(function(){}).then(function(){reject(abortError(signal));});
        }
        if(signal)signal.addEventListener('abort',onAbort,{once:true});
        if(signal&&signal.aborted){onAbort();return;}
        upload.findPreviousUploads().then(function(previous){if(settled)return;if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start();}).catch(fail);
      });
    });
  }

  global.uploadGovernanceFileWithRollback=function(file,target,legacyUploader,onProgress,signal){
    return storageEnabled().then(function(enabled){return enabled?directUpload(file,target,onProgress,signal):legacyUploader();});
  };

  global.deleteGovernanceFileWithVerification=function(source,id){
    return fetch('/api/storage/files/delete/prepare',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:source,id:id})})
      .then(jsonResponse).then(function(prepared){return fetch('/api/storage/files/delete/confirm',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmationToken:prepared.confirmationToken})}).then(jsonResponse);});
  };
})(window);
