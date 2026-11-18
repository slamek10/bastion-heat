# bastion-heat

## Server

- Host `192.168.10.12` (hostname `container-master`), user `root`.
- SSH: `ssh -i ~/.ssh/privateIS_openssh -o IdentitiesOnly=yes root@192.168.10.12`
  (`~/.ssh/privateIS_openssh` is the OpenSSH copy of the PuTTY key `~/.ssh/privateIS.ppk`.)
- This app lives in `/opt/bastion-heat` with its own `docker-compose.yaml`. The other Bastion apps are next to it in `/opt`.

## Deploy after every change (all Bastion apps)

When a change is finished and the checks pass, ship it without asking. This applies to every Bastion app: bastion-ha, bastion-ai, bastion-heat, bastion-cams and bastion-watch (each in `~/<app>`, GitHub `slamek10/<app>`, Docker Hub `islamek/<app>`, server `/opt/<app>`):

1. **GitHub:** commit the change on the current branch (only the files that belong to it, never `.DS_Store`) and `git push`.
2. **Image:** `./docker-push.sh` in the app's folder builds `islamek/<app>:latest` for linux/amd64 and pushes it to Docker Hub.
3. **Server:** `ssh -i ~/.ssh/privateIS_openssh -o IdentitiesOnly=yes root@192.168.10.12 'cd /opt/<app> && docker compose pull && docker compose up -d'`, then check that the container was recreated, is running, and is healthy.
4. **Notify:** send a push notification (PushNotification tool) naming the app, the commit, and the result: "deployed and healthy", or which step failed and why.

If a step fails, stop there, don't continue to the next one, and send the notification with the error.
