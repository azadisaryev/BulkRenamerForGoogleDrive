function doGet() {
  var t = HtmlService.createTemplateFromFile('index');
  return t
        .evaluate()
        .setTitle("Bulk Renamer for Google Drive™")
        .setSandboxMode(HtmlService.SandboxMode.IFRAME)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1')
        .setFaviconUrl("https://raw.githubusercontent.com/azadisaryev/BulkRenamerForGoogleDrive/master/static/bulkrenamer.png");
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getOAuthToken() {
  DriveApp.getRootFolder();
  return ScriptApp.getOAuthToken();
}

function retrieveAllFilesInFolder_(folderId) {
  var hasPageToken = true,
      pageToken,
      result = [];
  var q = "trashed=false and '"+folderId+"' in parents and mimeType!='application/vnd.google-apps.folder'";
  var fields = "items(createdDate,fileExtension,id,mimeType,modifiedDate,title),nextPageToken";

  var retrievePageOfFiles = function(pageToken, searchQuery, fieldsList) {
    return Drive.Files.list({pageToken:pageToken, q:searchQuery, fields:fieldsList});
  }

  while ( hasPageToken ) {
    var page = retrievePageOfFiles(pageToken, q, fields);
    result = result.concat(page.items);
    pageToken = page.nextPageToken;
    hasPageToken = pageToken;
  }
  
  return result;
}

function checkFolders(listFolders) {
  var result = [],
      arrFolders = ( listFolders ? listFolders.split(",") : [] );
      
  for ( var i=0; i<arrFolders.length; i++ ) {
    var id = arrFolders[i];
    try {
      var folder = Drive.Files.get(id, {fields:'title'}),
          files = retrieveAllFilesInFolder_(id),
          objFolder = {
            name: folder.title,
            id: id, 
            numitems: files.length, 
            items: files //[]
          };
    
      result.push( objFolder );
      
    }
    catch(e) {
      // silently trap errors: 
      // if folder does not exist or user does not have read permission for it, we just do not process the folder
    }
  }
  
  return result;
}


function doRenameFile(id, name, newname, moddate) {
  var result = {success:true, id:id, name:name, newname:false};
  try {
    Drive.Files.patch( {'title':newname}, id, {'updateViewedDate':false, 'setModifiedDate':(moddate===null?false:true), 'modifiedDate':moddate} );
    result.newname = newname;
  }
  catch(e) {
    result.success = false;
    result.err = e.message;
  }
  return result;
}

function doRenameFileWithBackoff(id, name, newname, moddate) {
  var result = {success:true, id:id, name:name, newname:false};

  try {
    rateLimitExpBackoff_(
      function() {return Drive.Files.patch( {'title':newname}, id, {'updateViewedDate':false, 'setModifiedDate':(moddate===null?false:true), 'modifiedDate':moddate} );}
    );
    result.newname = newname;
  }
  catch(e) {
    result.success = false;
    result.err = e.message;
  }
  return result;
}

/**
* rateLimitExpBackoff()
* @param {function} callBack some function to call that might return rate limit exception
* @param {number} sleepFor optional amount of time to sleep for on the first failure in missliseconds
* @param {number} maxAttempts optional maximum number of amounts to try
* @param {number} attempts optional the attempt number of this instance - usually only used recursively and not user supplied
* @return {object} results of the callback 
**/
function rateLimitExpBackoff_( callBack, sleepFor, maxAttempts, attempts ) {
  
  // can handle multiple error conditions by expanding this list
  function errorQualifies(errorText) {
    //Logger.log(errorText);
    return ["Exception: Service invoked too many times", "Exception: Rate Limit Exceeded", "Exception: User rate limit exceeded", "User Rate Limit Exceeded"].some(function(e){
              return errorText.toString().slice(0,e.length) == e;
            });
  }
  
  // sleep start default is  2 seconds
  sleepFor = Math.abs(sleepFor || 2000);
  // attempt number
  attempts = Math.abs(attempts || 1);
  // maximum tries before giving up
  maxAttempts = Math.abs(maxAttempts || 5);
  
  // check properly constructed
  if (!callBack || typeof(callBack) !== "function") {
    throw ("you need to specify a function for rateLimitBackoff to execute");
  }
  
  // try to execute it
  else {
    
    try {
      return callBack();
    }
    catch(err) {
      // failed due to rate limiting
      if ( errorQualifies(err) ) {
        //give up?
        if ( attempts > maxAttempts ) {
          throw (err + " (tried backing off " + (attempts-1) + " times");
        }
        else {
          // wait for some amount of time based on how many times we've tried plus a small random bit to avoid races
          Utilities.sleep( Math.pow(2,attempts)*sleepFor) + (Math.round(Math.random() * sleepFor) );
          // try again
          return rateLimitExpBackoff_( callBack, sleepFor, maxAttempts, attempts+1 );
        }
      }
      else {
        // some other error
        throw (err);
      }
    }
  }
};
