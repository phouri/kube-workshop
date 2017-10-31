# Kubernetes on Gcloud workshop

This walkthrough assumes you have gcloud sdk already configured and have a gcloud account (free tier)

## Kubernetes 101
Nodes, Pods, Deployments, Containers, Services, Master

#### Minikube
[Minikube](https://github.com/kubernetes/minikube) is designed to make it easy running kubernetes locally. 


## 1 - Creating Basic App

#### Creating basic app

Run `npm init` and approve everything

`npm install --save express`

create `index.js` file

add to it:

```js
const express = require('express');
const app = express();

app.get('/api', (req, res) => {
  res.send({
    api: 'v1',
  });
});

app.all('*', (req, res) => {
  res.send('Generic 404 Message');
});

app.listen('8005');
```
#### Create Dockerfile

```docker
from node:8.8.1
ADD . .
RUN npm install
CMD npm start 
```
#### Create image and push to gcr

`docker build . -t gcr.io/{PROJECT_ID}/{IMAGE_NAME}:{IMAGE_TAG}`

#### Create kube deployments
in the kube directory add the file `frontend-kube.yaml `
```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  type: NodePort
  ports:
  - port: 8005
  selector:
    app: frontend
---
apiVersion: apps/v1beta1
kind: Deployment
metadata:
  name: frontend
spec:
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:    
      - image: gcr.io/${PROJECT_ID}/${IMAGE_NAME}:${IMAGE_TAG}
        name: frontend
        resources:
          requests:
            memory: "128Mi"
            cpu: "50m"
          limits:
            memory: "512Mi"
            cpu: "150m"
        env:       
        ports:
          - containerPort: 8005
```

Now tell kubectl to apply this configuration:
`kubectl apply -f ./frontend-kube.yaml`

## 2 Adding load balancer
Our pod and service is now ready:

`kubectl get pods`
`kubectl get services` 

Should list them both, but they are not accessible from the outside (you can still use kubectl proxy if you wish you can read on it).

Let's create our L7 load balancer.
Gcloud already includes the L7 load balancer image that handles all this stuff so all we have to do is configure the ingress resource that maps services to the load balancer, you can off course add your own l7 load balancer but this is out of scope.

Create the `ingress.yaml` file under the kube dir

```yaml
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: ingress
  annotations:
    kubernetes.io/ingress.class: "gce"
spec:
  backend:
    serviceName: frontend
    servicePort: 8005
```

and `kubectl apply -f ./ingrss.yaml`
This can take a while (something like few minutes)

After a little while run `kubectl describe ingress ingress` and if all went well it should show the ip and the services running correctly

For minikube make sure you enable load balancer: `minikube addons enable ingress`

Ingress are created by default with an elastic ip, creating a static ip is very straight forward: https://github.com/kelseyhightower/ingress-with-static-ip
## 3 
Adding auto scaler

Now for some benefits of using Kubernetes (in short k8s)

Let's add an auto scaler for our frontend service

`kubectl autoscale deployment frontend --cpu-percent=65 --min=1 --max=5`

This is pretty straight forwards, it tells K8s to have a minimum of 1 and max of 5, and start increasing when average CPU is > 65
Autoscaler supports advanced customizations to include also memory and even application reported metrics for auto scaling.

## 4 Secrets
Let's spice things up

Let's say our deployment requires mysql
Let's start by adding mysql to our project
`npm install --save mysql2`

Let's setup connections to the db
Secrets are stored as base64 encoded

We will use basic secrets (root/root) and we will put them using a config file, in real world scenario you'd configure them once without the file

`echo -n "root" | base64` -> `cm9vdA==`

Set your `secrets.yaml` file:

```yml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
type: Opaque
data:
  username: cm9vdA==
  password: cm9vdA==
```

Note: You can apply all configurations at once: `kubectl apply -f ./kube` should apply all yamls in the directory, it can also recrusively go over all files if you include the `-r` flag. https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale-walkthrough/

Setup the `mysql.yaml` for mysql deployment and service:

This will create everything needed for a mysql, including a persisten volume that it will use

```yml
apiVersion: v1
kind: Service
metadata:
  name: mysql
spec:
  ports:
  - port: 3306
  selector:
    app: mysql
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-pv-claim
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 0.5Gi
---
apiVersion: apps/v1beta1
kind: Deployment
metadata:
  name: mysql
spec:
  selector:
    matchLabels:
      app: mysql
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: mysql
    spec:
      containers:
      - image: mysql:5.6
        name: mysql
        env:
        - name: MYSQL_ROOT_USER
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: username
        - name: MYSQL_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: password      
        ports:
        - containerPort: 3306
          name: mysql
        volumeMounts:
        - name: mysql-persistent-storage
          mountPath: /var/lib/mysql
      volumes:
      - name: mysql-persistent-storage
        persistentVolumeClaim:
          claimName: mysql-pv-claim
```

Upgrade your `index.js` to look like this:
```js
const express = require('express');
const app = express();
const mysql = require('mysql2/promise');

const start = function () {
  app.listen('8005', (err) => {
    if (err) {
      console.error('Error starting app', err);
    } else {
      console.log('Listening on 8005');
    }
  });
}
let connection;
async function setup() {
  try {
    connection = await mysql.createConnection({
      host: 'mysql',
      user: process.env.MYSQL_ROOT_USER,
      password: process.env.MYSQL_ROOT_PASSWORD
    });
    await connection.query('CREATE DATABASE IF NOT EXISTS demo');
    await connection.query('USE demo');
    await connection.query(`CREATE TABLE IF NOT EXISTS users(
      id INT NOT NULL AUTO_INCREMENT,
      PRIMARY KEY(id),
      name VARCHAR(30)
    )`);
    start();
  } catch (e) {
    console.error('Error setting up db', e);
  }
}

app.post('/add_user', async (req, res) => {
  try {
    if (!req.query.name) {
      res.status(400).send('Send name query param please');
    }
    await connection.query(`INSERT INTO users (name) VALUES(?)`, [req.query.name]);
    res.send('OK');
  } catch(e) {
    console.error('Error inserting user', e);
    res.status(500).send('Error');
  }
});

app.get('/users', async (req, res) => {
  try {
    const [users] = await connection.execute('SELECT * FROM users LIMIT 30');
    res.send(users);
  } catch (e) {
    console.error('Error fetching users', e);
    res.status(500).end();
  }
});

app.get('/api', (req, res) => {
  for (let i = 0; i < 1e4; i++) {
    let a = process.env;
  }
  res.send({
    api: 'v1',
  });
});

app.all('*', (req, res) => {
  res.send('Generic 404 Message');
});

setup();
```

## 5 Updating image and rolling update

Now after we have setup everything for using mysql, let's update our deployment to use the new image
(the version tag is because I did multiple steps ;) just increment from the last you used)
`docker build . -t gcr.io/turnkey-rookery-181318/frontend:v5`

and `gcloud docker -- push gcr.io/turnkey-rookery-181318/frontend:v5`

Now that this is done use kubectl to set the new image:
(It's also recommended to update the deployment file for future setup)
`kubectl set image deployments frontend frontend=gcr.io/turnkey-rookery-181318/frontend:v5 --all`

This takes care of the deployment in kubernetes, by creating a new pod with the new image and only after it's up it will shut down the older pod

It has many more advanced configuration, you can also do ab testing yada yada, feel free to read more.

## 6 TLS + Kube-Lego

In real use cases, your ingress will be with TLS termination so you can use https.

I won't go into details here, but this is easily configurable, but, it's also relatively easy to setup automatic certificate renewal via let's encrypt and a module called Kube-lego.

For an example look at the files under kube-lego

## 8 Basic trouble shooting
There some basic commands for troubleshootings

most common are
`kubectl get pod|service|ingress`
`kubectl describe pod|service|ingress ${resourceName}`
Pods only: `kubectl logs ${podName}`
You can also run bash on a pod and examine it: 
`kubectl exec -it ${podName} -- /bin/bash`

## 9 Ci cd 
CICD is very straight forward.

* On a git push - build image
* Push the image to container registry
* Update the canaris cluster with the new image and run tests / sanity
* If all is well - update the production image - K8s will take care of all the rest


## 10 Caveats Running Locally 

To make sure the docker is used by minikube run: `eval $(minikube docker-env)`

If you want to run your development environment not via docker, you can expose all the services with the minikube - 
for example in our mysql example: 

`minikube service mysql --url` would give you the url for the mysql server to use in dev - You might need to change the service type to NodePort to make sure it's exposeable. (instead of mysql host which won't be available - you can config it in /etc/hosts manually etc)

## 11 Advanced and more resources

* Network Policy - https://cloud.google.com/container-engine/docs/network-policy Inter pod communication firewall
* RBAC - https://kubernetes.io/docs/admin/authorization/rbac/


### **Don't forget to shutdown the cluster ;)**
