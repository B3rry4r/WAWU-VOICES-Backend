# The droplet's nginx.conf (Ubuntu 24.04 package) as provision.sh leaves it: worker_connections raised from the 768 default
# (LCH-09: 768 ran out from about 120 people at once; LOAD_WORKER_CONNECTIONS=768 reproduces the old one).
worker_processes 2;   # "auto" on a 2 vCPU droplet
pid __RUN__/nginx.pid;
error_log __RUN__/logs/nginx-error.log warn;
worker_rlimit_nofile 16384;   # LCH-09: set by provision.sh on the droplet
events {
    worker_connections __WORKER_CONNECTIONS__;
}
http {
    sendfile on;
    tcp_nopush on;
    types_hash_max_size 2048;
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    client_body_temp_path __RUN__/nginx-tmp/body;
    proxy_temp_path __RUN__/nginx-tmp/proxy;
    fastcgi_temp_path __RUN__/nginx-tmp/fcgi;
    uwsgi_temp_path __RUN__/nginx-tmp/uwsgi;
    scgi_temp_path __RUN__/nginx-tmp/scgi;
    log_format load '$remote_addr "$request" $status $body_bytes_sent rt=$request_time urt=$upstream_response_time cache=$upstream_cache_status';
    access_log __RUN__/logs/nginx-access.log load buffer=64k flush=5s;
    include __RUN__/voices.site.conf;
}
