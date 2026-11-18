# bastion-heat

## Server

- Host `192.168.10.12` (hostname `container-master`), user `root`.
- SSH: `ssh -i ~/.ssh/privateIS_openssh -o IdentitiesOnly=yes root@192.168.10.12`
  (`~/.ssh/privateIS_openssh` is the OpenSSH copy of the PuTTY key `~/.ssh/privateIS.ppk`.)
- This app lives in `/opt/bastion-heat` with its own `docker-compose.yaml`. The other Bastion apps are next to it in `/opt`.

## Shipping: the orchestrator deploys, not you

All Bastion apps are deployed by one orchestrator: the Claude session working in `/Users/islamek/bastion`, the folder that holds every app. Don't run `./docker-push.sh`, don't pull or restart containers on the server, and don't send the deploy notification yourself.

When a change is finished and the checks pass, without asking:

1. **GitHub:** commit the change on the current branch (only the files that belong to it, never `.DS_Store`) and `git push`. Leave the working tree clean at that commit: the orchestrator builds the image from this folder.
2. **Hand off:** tell the orchestrator in one line: `ready to ship: <app> <branch> <commit> — <one-line summary>`, followed by anything the deploy needs (a new env var or volume in the server's `docker-compose.yaml`, a data migration, another app that has to ship first). If `ListAgents` shows the orchestrator session, send it there with `SendMessage`; otherwise end your reply with that line so the user can pass it on.

The server access above is for logs and debugging. Changes the deploy needs on the server go in the hand-off, and the orchestrator makes them.
