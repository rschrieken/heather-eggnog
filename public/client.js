console.log('script loaded');

function setSearch(params) {
  //debugger;
  document.location.search = params.join('&');
}

function getSearch() {
  var params = document.location.search.split('&');
  if (params.length > 0) {
        params[0] = params[0].substr(1);
  }
  if (params.length > 0 && params[0] === "") {
    params.shift();
  }
  return params;
}

function findUserIdSearch(params, fi , nf) {
  var i = params.findIndex((i) => {return i.indexOf('userid=') === 0}); 
  if (i > -1) {
    if (fi) fi(i);
  } else {
    if (nf) nf(i);
  }
  return i;
}

function initSelect() {
  var btn = document.getElementById("selectuser"),  uid = document.getElementById("userid");
  if (btn && uid) {
    btn.addEventListener('click', function() {
      var val = uid.value, params = getSearch();  
      if (val) {
        val = parseInt(val,10); 
        if (!Number.isNaN(val)) {
          val = "userid=" + val;
          findUserIdSearch(params, (i) => {params[i] = val}, (i) => {params.push(val)});
          setSearch(params);
        }
      } 
    });
  }
}

function initDeselect() {
  var btn = document.getElementById("deselectuser");
  if (btn) {
    btn.addEventListener('click', function() {
      var params = getSearch();
      findUserIdSearch(params, (i) => { params.splice(i, 1);}); 
      setSearch(params);
    });
  }
}

document.addEventListener("DOMContentLoaded", function(event) {
  
    console.log("DOM fully loaded and parsed");
    initSelect();
    initDeselect();
});