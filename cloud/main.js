
Parse.Cloud.define('hello', function(req, res) {
  res.success('Hi');
});

// globals
var _SE_BASE 	= 	"http://streeteasy.com/nyc/api/rentals/search";
var _SE_PARAMS 	= 	{
	criteria: "&criteria=rental_type:frbo,brokernofee,brokerfee|price:1750-2152|area:115,158,116,108,162,107,157,306,322,323,305|beds:=1|sort_by:listed_desc|",
	limit: 50,
	format: "json",
	key: "0523e568930021b573ca6e1e1089327b61ad56e9" // "18349ae37094e6406c141f395762c614246590b9" // alt
}
// sample: http://streeteasy.com/nyc/api/rentals/search?format=json&key=18349ae37094e6406c141f395762c614246590b9&limit=50&criteria=rental_type:frbo,brokernofee,brokerfee|price:1500-2799|area:162,107,157|beds:1|
var _USER_EXISTING_LISTINGS = [];
var _USER_DESTROY_LISTINGS = [];
var _SAVE_OBJS = [];
var LISTINGS_VALID_TTL = 604800000; // 7 days
// testing data (overridden when the function is called via the job)
var userId = null; // "mattrestivo"; // depricating.
var inquiryId = "JGn1ubwaff";

// helpers
var indexOf=function(n){return indexOf="function"==typeof Array.prototype.indexOf?Array.prototype.indexOf:function(n){var r=-1,t=-1;for(r=0;r<this.length;r++)if(this[r]===n){t=r;break}return t},indexOf.call(this,n)};
var _ = require('underscore.js');
var Mailgun = require('mailgun');
replaceAll = function(find, replace, str) {
  return str.replace(new RegExp(find, 'g'), replace);
}
Mailgun.initialize('mg.mattrestivo.com', 'key-ef6f2ffb1718bfeb99f84a0dbb6b71e6');

// main function, fetch listings for specified user and criteria
var fetchListingsForUserQuery = function(request, response){

	var saveObjects = [];
	var promise = new Parse.Promise();
	
	// change the parameters here based on userInquiry
	if ( request ){
		if ( request.criteria ){
			_SE_PARAMS.criteria = request.criteria;
		}
//		if ( request.userId ){ // depricate
//			userId = request.userId;
//		}
		if ( request.user ){
			user = request.user;
		}
		if ( request.inquiryId ){
			inquiryId = request.inquiryId;
		}
	}
	
	console.log('* fetchListingsForUserQuery - user:' + user + ', inquiry:' + _SE_PARAMS.criteria);
	
	// first let's figure out what listings the user has already seen
	var query = new Parse.Query("UserInquiryListing");
	if ( user ){
		query.equalTo("userId", user);		
	} else if ( userId ){
		query.equalTo("userId", userId); // depricate
	}

	query.limit(1000);
	query.find().then(function(results){
			
			if (results.length > 0){
				_USER_EXISTING_LISTINGS = [];
				_USER_DESTROY_LISTINGS = [];
				for ( var i=0; i<results.length; i++){
					if ( results[i] ){
						obj = results[i];
						tempListingId = obj.get("listingId");
						
						now = new Date();
						diff = new Date(obj.get('created'));
						diff = now - diff;
						if ( diff > LISTINGS_VALID_TTL ){
							//console.log('found a listing that falls outside the window we want');
							_USER_DESTROY_LISTINGS[_USER_DESTROY_LISTINGS.length] = obj;
						}
						
						_USER_EXISTING_LISTINGS[_USER_EXISTING_LISTINGS.length] = tempListingId;
					}
				}
				//console.log('ok, temp stored all of user listings');
			}                 
			else    
			{                 
				//console.log('note this user does not yet have any listings stored');
			}
			return Parse.Promise.as();
		}
		
	// we need to destroy listings older than LISTINGS_VALID_TTL
	).then(
		function(){
			var promise = Parse.Promise.as();
			_.each(_USER_DESTROY_LISTINGS, function(obj) {
				// For each item, extend the promise with a function to delete it.
				promise = promise.then(function() {
					// Return a promise that will be resolved when the delete is finished.
					console.log('destroying old listings so we dont have too many to de-dup ->');
					//console.log(obj);
					return obj.destroy();
				});
			});
			return promise;
		}
	
	// with this list, now let's get the new listings.	
	).then(
		function(){
			//console.log('making http request');
			return Parse.Cloud.httpRequest({
				url: _SE_BASE,
				params: _SE_PARAMS,
				method: "GET"
			});
			
		}
	// we finally sorted this out, now let's save
	).then(
		function(httpResponse){
			jResponse = JSON.parse(httpResponse.text);
			if ( jResponse ){
				// we can easily exclude records we already got, and write them to parse
				if ( jResponse.listings ){
					
					// 7/17 -- streeteasy API updated.
					// listingsArray = jResponse.listings;
					
					lObject = jResponse.listings;
					if ( lObject.object ){
						
						lObjectObjectArray = lObject.object;
						listingsArray = lObjectObjectArray;
					
						if ( listingsArray.length > 0 ){
							// console.log(listingsArray.length);
							_SAVE_OBJS = [];
							for (var i=0; i<listingsArray.length; i++){
								if ( listingsArray[i] ){
									obj = listingsArray[i];
									obj = obj.rental; // note that this needs to be changed if we support sales.
									now = new Date();
									diff = new Date(obj.created_at);
									diff = now - diff;
									if ( indexOf.call(_USER_EXISTING_LISTINGS, obj.id+"") == -1 && diff < LISTINGS_VALID_TTL && obj.building_idstr ){ 
										var newListing = new Parse.Object("UserInquiryListing");			
										listingId = obj.id+'';
										listingPrice = obj.price+'';
										listingTitle = obj.title;
										listingCreated = obj.created_at;
										
										// listing url
										// api update 7/17 now we have to manually build url. // listingUrl = obj.url+'';
										streetAddress = obj.building_idstr;
										streetAddress = streetAddress.replace(/\s+/g, '-');
										listingUrl = "http://streeteasy.com/building/" + streetAddress + "/" + obj.addr_unit_idstr;
										listingUrl = listingUrl.toLowerCase();
										
										// source
										sourceUrl = null;
										if ( obj.sourceuri != '' ){
											sourceUrl = obj.sourceuri+'';
										}
										
										// thumb
										thumbUrl = obj.medium_image_uri;
										if ( thumbUrl == "/images2014/no_photo_medium_square.png" ){
											thumbUrl = "http://cdn-img0.streeteasy.com/images2014/no_photo_medium_square.png";
										}
										
										newListing.set("title", listingTitle);
										newListing.set("price", listingPrice);
										if ( user ){
											newListing.set("userId", user);
										} else {
											newListing.set("userId", userId);
										}
										newListing.set("listingId", listingId);
										newListing.set("inquiryId", inquiryId);
										newListing.set("thumbUrl", thumbUrl);
										newListing.set("url", listingUrl);
										newListing.set("sourceUrl", sourceUrl);
										newListing.set("created", listingCreated);
										
										_SAVE_OBJS[_SAVE_OBJS.length] = newListing;

									} else {
										//console.log('found a duplicate listing: ' + obj.id);
									}
								}
							}
							
							if ( _SAVE_OBJS.length > 0 ){
								console.log('saving ' + _SAVE_OBJS.length + ' new listings for user.');
							}
							return Parse.Object.saveAll(_SAVE_OBJS);
						
						}
					}						
				}
			}
			
		}).then(
			function(savedObjects){
				
				var notificationPromise = new Parse.Promise();
				
				// extract email building @todo
				subject = "";
				text = "";
				pushBadge = 0;
				pushObjectId = "";
				pushUrl = "";
				
				if ( savedObjects ){
					if ( savedObjects.length > 0 ){
					
						if ( savedObjects.length > 1 ){
							subject = savedObjects.length + " New Listings!";
							pushBadge = savedObjects.length;
							for ( var k=0; k<savedObjects.length; k++){
								obj = savedObjects[k];
								text = text + "$" + obj.get("price") + " <a href='" + obj.get("url") + "'>" + obj.get("title") + "</a>";
								if ( obj.get("sourceUrl") ){
									text = text + " | <a href='"+obj.get('sourceUrl')+"'>Original Listing</a>";
								}
								if ( obj.get("thumbUrl") ){
									text = text + "<br/><img src='"+obj.get('thumbUrl')+"' />";
								}
								text = text + "<br/><br/>";
								
								// figure out a strategy for multiple listings
								pushObjectId = obj.id; // ensure this works.
								pushUrl = obj.get("url");
							}
						} else {
							obj = savedObjects[0];
							pushBadge = 1;
							pushObjectId = obj.id;
							pushUrl = obj.get("url");
							subject = "New: $" + obj.get("price") + " " + obj.get("title");
							text = "$" + obj.get("price") + " <a href='" + obj.get("url") + "'>" + obj.get("title") + "</a>";
							if ( obj.get("sourceUrl") ){
								text = text + " | <a href='"+obj.get('sourceUrl')+"'>Original Listing</a>";
							}
							if ( obj.get("thumbUrl") ){
								text = text + "<br/><img src='"+obj.get('thumbUrl')+"' /><br/>";
							}
							text = text + "<br/><br/>";
						}
		
						// get user email
						// console.log(user);
						// console.log(userId);
						if ( user ){
							var query = new Parse.Query("User");
							query.equalTo("objectId", user);
						} else {
							var query = new Parse.Query("User");
							query.equalTo("userId", userId); // depricate
						}
						query.find().then(function(results){
							//console.log('results');
							//console.log(results);
							if ( results && results.length == 1 ){
								userObj = results[0];
								if ( userObj ){
									// extract this into a function!! @todo
									email = userObj.get("email");
									isEnabled = userObj.get("enabled");
									if ( email && isEnabled ){
										
										// @todo - remove this once everyone is onboarded to app
										if ( user == "FY0LGncI6C" ){
											console.log('breaking into push for this user');
											// this is restivo, fork this for push notifications
											var pushQuery = new Parse.Query(Parse.Installation);
											pushQuery.equalTo('deviceType', 'ios');
											pushQuery.equalTo('channels', user);
    
											Parse.Push.send({
												where: pushQuery, // Set our Installation query
												data: {
													alert: subject,
													badge: pushBadge,
													id: pushObjectId,
													url: pushUrl
												}
											}, {
												success: function() {
													// Push was successful
													notificationPromise.resolve(savedObjects);
												},
												error: function(error) {
													notificationPromise.reject(error);
													throw "Got an error " + error.code + " : " + error.message;
												}
											});
											
										} else {
											console.log('about to send email to -> ' + email);
											Mailgun.sendEmail({
												to: email,
												from: "maillist@mattrestivo.com",
												subject: subject,
												html: text
											}, {
												success: function(httpResponse) {
													//console.log(httpResponse);
													notificationPromise.resolve(savedObjects);
												},
												error: function(httpResponse) {
													//console.error(httpResponse);
													notificationPromise.reject(httpResponse);
												}
											});
										}
										
									} else {
										notificationPromise.resolve(savedObjects); // move along, no valid email
									}
								}
							} else {
								console.log('no registered user found via query');
								notificationPromise.resolve(savedObjects); // move along, no user registered.
							}
						});
					
					} else {
						notificationPromise.resolve(savedObjects); // move along, nothing to save here.
					}
				} else {
					notificationPromise.resolve(savedObjects); // move along, nothing to save here.
				}
				
				return notificationPromise;
				
			}
		).then(
			function(savedObjects){
				
				console.log('*****');
				//response.success(a);
				promise.resolve(savedObjects);
			
			}, function(error) {

				console.log('* fetchListingsForUserQuery ERRORED');
				console.log(error);
				console.log('*****');
				//response.error(error);
				promise.reject(error);

			}
		);
	
	return promise;	// note that we get here immediately when the function is called.
	
};

// fetchApartmentsForQuery. 
Parse.Cloud.define("fetchListingsForUserQuery", function(request, response){
	return fetchListingsForUserQuery(request,response);
});


// setup job to run that finds listings for all queries
// note that there are now 2 of these jobs, so if you change this code, it needs to be changed below.
Parse.Cloud.job("fetchListingsForAllUsers", function(request, status) {

	if ( request ){
		if ( request.params && request.params.apikey ){
			_SE_PARAMS.key = request.params.apikey; // allows me to run multiple jobs with multiple apikeys
		}
	}

	// Set up to modify user data
	console.log('*********************');
	console.log('STARTING FETCH JOB');
	console.log('Time: ' + new Date());
	console.log('API Key: ' + _SE_PARAMS.key);
	console.log('*********************');
  
	// Query for all inquiries
	var query = new Parse.Query("UserInquiry");
  
	query.find().then(function(results){
  	
		var promise = Parse.Promise.as();
		_.each(results, function(result){
			promise = promise.then(function(){
				r = {};
				enabled = false; // true;// = false;
				if ( result ){
					//r.userId = result.get("userId"); // depricating.
					r.user = result.get("user");
					r.criteria = result.get("InquiryParameters");
					r.inquiryId = result.id;
					enabled = result.get("enabled");
				}
				if ( enabled ){
					return fetchListingsForUserQuery(r,null);
				} else {
					return promise.resolve();
				}
			});
		});
	  
		return promise;
	
	}).then(function(request) {
	
		console.log('*********************');
		console.log('COMPLETED FETCH JOB');
		console.log("Successfully looped through all users, and called listing fetch");
		console.log('*********************');
		status.success('Success');
	
	}, function(error) {
		// Set the job's error status
		console.log('*********************');
		console.log('FETCH JOB ERRORED');
		console.log('*********************');
		status.error("Uh oh, something went wrong with the query.");
	});
  
});


Parse.Cloud.job("fetchListingsForAllUsers2", function(request, status) {
	if ( request ){
		if ( request.params && request.params.apikey ){
			_SE_PARAMS.key = request.params.apikey; // allows me to run multiple jobs with multiple apikeys
		}
	}

	// Set up to modify user data
	console.log('*********************');
	console.log('STARTING FETCH JOB #2');
	console.log('Time: ' + new Date());
	console.log('API Key: ' + _SE_PARAMS.key);
	console.log('*********************');
  
	// Query for all inquiries
	var query = new Parse.Query("UserInquiry");
  
	query.find().then(function(results){
  	
		var promise = Parse.Promise.as();
		_.each(results, function(result){
			promise = promise.then(function(){
				r = {};
				enabled = false; // true;// = false;
				if ( result ){
					//r.userId = result.get("userId"); // depricating.
					r.user = result.get("user");
					r.criteria = result.get("InquiryParameters");
					r.inquiryId = result.id;
					enabled = result.get("enabled");
				}
				if ( enabled ){
					return fetchListingsForUserQuery(r,null);
				} else {
					return promise.resolve();
				}
			});
		});
	  
		return promise;
	
	}).then(function(request) {
	
		console.log('*********************');
		console.log('COMPLETED FETCH JOB #2');
		console.log("Successfully looped through all users, and called listing fetch");
		console.log('*********************');
		status.success('Success');
	
	}, function(error) {
		// Set the job's error status
		console.log('*********************');
		console.log('FETCH JOB #2 ERRORED');
		console.log('*********************');
		status.error("Uh oh, something went wrong with the query.");
	});
});
