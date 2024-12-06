import http from 'k6/http';
import { sleep, check } from 'k6';

export default function () {
    const res = http.post('http://localhost:3000/pdf', JSON.stringify({
       url: "https://metropolis.chaika.com",
       options: {
          // waitForSelector: "#test"
       }
    }), { headers: { 'Content-Type': 'application/json' } });
    check(res, { 'status is 200': (r) => r.status === 200 });
    sleep(1);
}