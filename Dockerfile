from node:8.8.1-slim
ADD . .
RUN npm install

CMD npm start