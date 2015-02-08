var http = require('http')
	fs = require('fs'),
	parseURL = require('url').parse,
	resolveURL = require('url').resolve,
	parseQS = require('querystring').parse;

//- General server and form

var port = process.env.PORT || 8080;
http.createServer(function(req, res) {
	console.log('>>', req.connection.remoteAddress, req.method, req.url);

	var url = parseURL(req.url, true);
	switch (url.pathname) {
		case '/':
			send(res, 200, fs.readFileSync('static/form.html', {encoding:'utf8'}));
			break;
		case '/ping':
			send(res, 200);
			break;
		case '/redir':
			var n = parseInt(url.query.n) || 0;
			if (n > 0) {
				var u = req.url.replace(n, n-1);
				send(res, 302, {Location:u});
			} else {
				send(res, 200);
			}
			break;
		case '/trace':
			extractForm(req, wrap(res, function(data) {
				runTrace(res, data); 
			}));
			break;
		default:
			send(res, 404);
	}
}).listen(port, function(){
	console.log('Traceroute server listening on port', port);
});

function copy(dest, src) {
	for (var key in src) {
		dest[key] = src[key];
	}
}

function send(res, status, html) {
	var headers = {'Content-Type': 'text/html'};
	if (typeof html === 'object') {
		copy(headers, html);
		html = null;
	}
	headers['Content-Length'] = Buffer.byteLength(html||'', 'utf8');
	res.writeHead(status, headers);
	res.end(html);
}

function wrap(res, fn) {
	return function(err, data) {
		if (err) return send(res, 500, err.stack || err.message);
		fn(data);
	};
}

//- Templating

const INTRO   = 0;
const URL     = 1;
const STATUS  = 2;
const OUTRO   = 3;

var templates;
function loadTemplates() {
	templates = fs.readFileSync('static/result.html', {encoding:'utf8'}).split('\n\n');
}

function replace(str, data) {
	return str.replace(/\{(\w+)\}/g, function(all, key) {
		return data[key];
	});
}

function write(res, index, data) {
	var tpl = templates[index];
	if (data) {
		tpl = replace(tpl, data);
	}
	res.write(tpl);
	res.write('\n');
	if (index === OUTRO) {
		res.end();
	}
}

//- Form data

const COUNTRIES = {
	ar: {ip:'1.1.1.1', lang:'es-ar'},
	br: {ip:'2.2.2.2', lang:'pt-br'},
	cl: {ip:'201.220.244.147', lang:'es-cl'}
};

const DEVICES = {
	iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 8_1_2 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Mobile/12B440',
	android: 'Mozilla/5.0 (Linux; U; Android 4.2.2; {lang}; GT-I9150 Build/JDQ39) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30'
};

function extractForm(req, done) {
	req.on('readable', function() {
		req.setEncoding('utf8');
		var data = parseQS(req.read());
		done(null, data);
	}).on('error', done);
}

//- Tracing

function runTrace(res, data) {
	// Load each time so no need to restart the server
	loadTemplates();

	res.writeHead(200, {'Content-Type': 'text/html'});
	write(res, INTRO);
	copy(data, COUNTRIES[data.country]);
	data.ua = replace(DEVICES[data.device], data);
	data.lang += ',en-us';
	data.hops = 0;

	request(res, data.url, data);
}

const MAX_HOPS = 20;

function request(res, url, data) {
	data.url = url;
	write(res, URL, data);

	var opts = parseURL(url);
	copy(opts, {
		method: data.method,
		headers: {
			'Host': opts.host,
			'X-Forwarded-For': data.ip,
			'Accept-language': data.lang,
			'User-Agent': data.ua
		},
		agent: false
	});

	var start = Date.now();
	var prot = opts.protocol.slice(0, -1);
	// We don't support this protocol
	if (prot.indexOf('http') === -1) {
		return write(res, OUTRO);
	}

	var req = require(prot).request(opts, function(reply) {
		var elapsed = Date.now() - start;
		var status = reply.statusCode;
		var location = getLocation(reply, url);
		var atLimit = ++data.hops === MAX_HOPS;
		write(res, STATUS, {
			status: status, 
			msg: http.STATUS_CODES[status],
			type: Math.floor(status / 100),
			limit: atLimit && location ? 'limit' : '',
			elapsed: elapsed
		});
		// Dump
		reply.resume();

		if (location && !atLimit) {
			// TODO: This is how it works no?
			data.method = 'GET';
			request(res, location, data);
		} else {
			write(res, OUTRO);
		}
	});
	
	/* TODO: Try to really change the IP
	req.on('socket', function(socket) {
		console.log(req.connection);
	});*/

	req.on('error', wrap(res));
	req.end();
}

function getLocation(res, url) {
	var loc = res.headers.location;
	if (!loc) return null;
	return resolveURL(url, loc);
}

