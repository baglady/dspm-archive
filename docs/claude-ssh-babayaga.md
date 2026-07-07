# Claude SSH access to babayaga — history & removal record

## What was set up

During the `norns-docker-debian` work (session `43c2b497`, 2026-06-24), a
dedicated ed25519 keypair was generated so Claude Code could SSH into
**babayaga** (the home Debian/YunoHost box) to run commands directly during
assisted setup.

### Local side (Windows laptop)

| Item | Path / value |
|---|---|
| Private key | `~/.ssh/id_ed25519_babayaga` |
| Public key | `~/.ssh/id_ed25519_babayaga.pub` |
| SSH config block | `~/.ssh/config` → Host `babayaga` |

SSH config stanza:

```
Host babayaga
    HostName babayaga.nohost.me
    User baglady
    IdentityFile ~/.ssh/id_ed25519_babayaga
    IdentitiesOnly yes
```

Public key that was installed on the box:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP8BHHpxaJ4gRgH6Y32iLqRfMhkTAxKkkoSdYyWVbxR/ claude-code@dspm-archive-20260623
```

### Remote side (babayaga)

The public key was appended to `/home/baglady/.ssh/authorized_keys`.

User `baglady` has passwordless sudo; the session ran `sudo docker …` commands
(not in docker group) via this key.

## Why it existed

Used for a single assisted session to: pull the schollz/norns-desktop image,
patch and wire up run-dspm.sh, install dspm-norns.service, configure icecast +
darkice for the radio stream, and verify end-to-end OSC feedback. Completed
and no longer needed.

## Removal

**Remote:** `ssh babayaga "sed -i '/claude-code@dspm-archive-20260623/d' ~/.ssh/authorized_keys"`

**Local keys:** `rm ~/.ssh/id_ed25519_babayaga ~/.ssh/id_ed25519_babayaga.pub`

**SSH config:** remove the `Host babayaga` block from `~/.ssh/config`

All three steps are done; this doc is the record.
