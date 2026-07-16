import json
import os
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db, SessionLocal, DATA_DIR
from models import CompanionConfig, CompanionMessage, Creator, Image


def _vault_image_b64(path: str, max_dim: int = 768) -> str | None:
    """Read an image file, downscale, and base64-encode it for a vision model."""
    try:
        from PIL import Image as PILImage
        import io, base64
        with PILImage.open(path) as im:
            im = im.convert("RGB")
            im.thumbnail((max_dim, max_dim))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=85)
            return base64.b64encode(buf.getvalue()).decode()
    except Exception:
        return None
async def _ensure_avatar_desc(db: Session, persona, config) -> None:
    """Generate & cache a factual text description of the persona's avatar so she
    always knows what her own profile picture looks like. Regenerated only when the
    avatar file changes (avatar_desc_src != current path) — otherwise a no-op."""
    if not persona or not getattr(persona, "avatar_path", None):
        return
    if not bool(getattr(config, "vision_enabled", True)):
        return
    ap = persona.avatar_path
    if not os.path.exists(ap):
        return
    if persona.avatar_desc and persona.avatar_desc_src == ap:
        return  # already described for this exact avatar
    b = _vault_image_b64(ap)
    if not b:
        return
    prompt = (
        "This is someone's profile picture. Describe it factually in 2-3 sentences so the person "
        "in it could recognise herself: the character or theme portrayed (if it's a cosplay), hair "
        "colour and style, every clothing item and its colour, gloves, headwear, notable accessories, "
        "and whether she is wearing bottoms (pants/shorts/skirt) or not. Describe only what is "
        "visible. No preamble, no disclaimers."
    )
    payload = {
        "model": config.ollama_model, "stream": False,
        "keep_alive": config.keep_alive or "10m", "think": False,
        "options": {"num_predict": 220, "num_ctx": config.num_ctx or 16384},
        "messages": [{"role": "user", "content": prompt, "images": [b]}],
    }
    try:
        import httpx
        timeout = httpx.Timeout(connect=15.0, read=600.0, write=30.0, pool=5.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{config.ollama_url.rstrip('/')}/api/chat", json=payload)
            if r.status_code >= 400:
                return
            desc = ((r.json().get("message") or {}).get("content") or "").strip()
        if desc:
            persona.avatar_desc = desc
            persona.avatar_desc_src = ap
            db.commit()
    except Exception:
        db.rollback()


async def _bg_avatar_desc(persona_id: int) -> None:
    """Background-safe wrapper: open its own session and cache a persona's avatar
    description. Safe to call fire-and-forget after a stream or on persona switch."""
    db = SessionLocal()
    try:
        cfg = db.query(CompanionConfig).first()
        p = db.query(Creator).filter(Creator.id == persona_id).first()
        if cfg and p:
            await _ensure_avatar_desc(db, p, cfg)
    finally:
        db.close()


from schemas import CompanionConfigOut, CompanionConfigUpdate, CompanionMessageOut
from services.companion import (
    OllamaClient, build_system_prompt, build_vault_context,
    build_persona_prompt, get_bond_tier, get_bond_prompt, bond_xp_for_next,
    get_effective_companion_xp, BOND_LEVELS
)

router = APIRouter()

AVATARS_DIR = os.path.join(DATA_DIR, "companion_avatars")
os.makedirs(AVATARS_DIR, exist_ok=True)


def _get_or_create_config(db: Session) -> CompanionConfig:
    config = db.query(CompanionConfig).first()
    if not config:
        config = CompanionConfig()
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


# ── Config ────────────────────────────────────────────────────────────────────

@router.get("/config", response_model=CompanionConfigOut)
def get_config(db: Session = Depends(get_db)):
    return _get_or_create_config(db)


@router.patch("/config", response_model=CompanionConfigOut)
def update_config(data: CompanionConfigUpdate, background_tasks: BackgroundTasks,
                  db: Session = Depends(get_db)):
    config = _get_or_create_config(db)
    prev_persona = config.active_persona_id
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(config, field, value)
    db.commit()
    db.refresh(config)
    # Opening a chat with a persona sets active_persona_id — prep her appearance in
    # the background so she knows her own pfp by the time the first message is sent.
    if config.active_persona_id and config.active_persona_id != prev_persona:
        background_tasks.add_task(_bg_avatar_desc, config.active_persona_id)
    return config


# ── Avatar ────────────────────────────────────────────────────────────────────

@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), db: Session = Depends(get_db)):
    config = _get_or_create_config(db)
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    path = os.path.join(AVATARS_DIR, f"companion_avatar{ext}")
    content = await file.read()
    with open(path, "wb") as f:
        f.write(content)
    config.avatar_path = path
    db.commit()
    return {"avatar_path": path}


@router.get("/avatar")
def get_avatar(db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse
    config = _get_or_create_config(db)
    if not config.avatar_path or not os.path.isfile(config.avatar_path):
        raise HTTPException(404, "No avatar set")
    return FileResponse(config.avatar_path)


# ── Chat history ──────────────────────────────────────────────────────────────

@router.get("/history", response_model=list[CompanionMessageOut])
def get_history(limit: int = 50, persona_id: int = None, db: Session = Depends(get_db)):
    q = db.query(CompanionMessage)
    if persona_id is not None:
        q = q.filter(CompanionMessage.persona_id == persona_id)
    else:
        q = q.filter(CompanionMessage.persona_id == None)  # noqa: E711
    msgs = q.order_by(CompanionMessage.created_at.desc()).limit(limit).all()
    return list(reversed(msgs))


@router.delete("/history")
def clear_history(persona_id: int = None, db: Session = Depends(get_db)):
    """
    No persona_id  → wipe ALL messages (danger zone button)
    persona_id = N → wipe only that creator's messages
    """
    q = db.query(CompanionMessage)
    if persona_id is not None:
        q = q.filter(CompanionMessage.persona_id == persona_id)
    q.delete(synchronize_session=False)
    db.commit()
    return {"deleted": True}


@router.post("/session-break", response_model=CompanionMessageOut)
def session_break(persona_id: int = None, db: Session = Depends(get_db)):
    """Insert a break marker — history stays, context window resets after this point."""
    marker = CompanionMessage(role="break", content="", persona_id=persona_id)
    db.add(marker)
    db.commit()
    db.refresh(marker)
    return marker


# ── Bond ──────────────────────────────────────────────────────────────────────

@router.post("/bond/reset")
def reset_bond(db: Session = Depends(get_db)):
    config = _get_or_create_config(db)
    config.bond_xp    = 0
    config.bond_level = 0
    db.commit()
    return {"bond_xp": 0, "bond_level": 0}


@router.get("/bond")
def get_bond(db: Session = Depends(get_db)):
    config = _get_or_create_config(db)
    # Return the active persona's bond if one is set
    if config.active_persona_id:
        c = db.query(Creator).filter(Creator.id == config.active_persona_id).first()
        if c:
            xp = get_effective_companion_xp(db, c)
            tier, name, _ = get_bond_tier(xp)
            return {
                "bond_xp":    xp,
                "bond_level": tier,
                "bond_name":  name,
                "next_at":    bond_xp_for_next(xp),
                "max_level":  len(BOND_LEVELS) - 1,
                "persona_id": c.id,
                "persona_name": c.name,
                "vault_synced": True,
            }
    tier, name, _ = get_bond_tier(config.bond_xp)
    return {
        "bond_xp":    config.bond_xp,
        "bond_level": tier,
        "bond_name":  name,
        "next_at":    bond_xp_for_next(config.bond_xp),
        "max_level":  len(BOND_LEVELS) - 1,
        "persona_id": None,
        "persona_name": config.name,
    }


# ── Ollama status ─────────────────────────────────────────────────────────────

@router.get("/ollama/status")
async def ollama_status(db: Session = Depends(get_db)):
    config = _get_or_create_config(db)
    client = OllamaClient(config.ollama_url, config.ollama_model)
    result = await client.check_connection()
    return result


@router.post("/ollama/unload")
async def ollama_unload(db: Session = Depends(get_db)):
    """Force Ollama to evict the current model from VRAM immediately."""
    import httpx
    config = _get_or_create_config(db)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Sending keep_alive=0 with an empty prompt tells Ollama to unload the model now
            await client.post(
                f"{config.ollama_url}/api/generate",
                json={"model": config.ollama_model, "keep_alive": 0, "prompt": ""},
            )
        return {"unloaded": True, "model": config.ollama_model}
    except Exception as e:
        raise HTTPException(500, f"Could not reach Ollama: {e}")


# ── Chat (streaming) ─────────────────────────────────────────────────────────

@router.post("/chat")
async def chat(data: dict, db: Session = Depends(get_db)):
    config = _get_or_create_config(db)
    if not config.enabled:
        raise HTTPException(403, "Companion is disabled")

    user_message = (data.get("message") or "").strip()
    if not user_message:
        raise HTTPException(400, "Empty message")

    device_connected  = bool(data.get("device_connected", False))
    image_b64         = data.get("image_b64")         # base64 only (for Ollama)
    image_data_url    = data.get("image_data_url")    # full data:image/...;base64,... (for storage)

    # Route bond XP to the persona's creator record, or to Erika's global bond
    if config.active_persona_id:
        persona_creator = db.query(Creator).filter(Creator.id == config.active_persona_id).first()
        if persona_creator:
            # Safety net: a creator imported since the last restart may not have a
            # personality yet — give her one before her voice is built.
            if not getattr(persona_creator, 'personality_assigned', False):
                from services.companion import assign_personality
                assign_personality(persona_creator)
            persona_creator.companion_bond_xp = (persona_creator.companion_bond_xp or 0) + 10
            tier, _, _ = get_bond_tier(persona_creator.companion_bond_xp)
            persona_creator.companion_bond_level = tier
            bond_level = tier
        else:
            bond_level = 0
    else:
        bond_level, _, _ = get_bond_tier(config.bond_xp)
        config.bond_xp   += 10
        new_tier, _, _    = get_bond_tier(config.bond_xp)
        config.bond_level = new_tier

    system_prompt = build_system_prompt(db, config, device_connected=device_connected)

    # Fetch all messages for this persona (ascending), find the last break,
    # then only pass messages after the break to Ollama.
    pid = config.active_persona_id
    pid_filter = (CompanionMessage.persona_id == pid) if pid is not None else (CompanionMessage.persona_id == None)  # noqa: E711
    all_history = (
        db.query(CompanionMessage)
        .filter(pid_filter)
        .order_by(CompanionMessage.created_at.asc())
        .all()
    )
    last_break = -1
    for i, m in enumerate(all_history):
        if m.role == "break":
            last_break = i
    context_msgs = [m for m in all_history[last_break + 1:] if m.role not in ("break",)][-20:]
    messages = [{"role": m.role, "content": m.content} for m in context_msgs]

    vision = bool(getattr(config, "vision_enabled", True))

    # Her own look is handled by the cached avatar description in the system prompt
    # (see _ensure_avatar_desc) — no per-turn image needed. Images ride on the SINGLE
    # user turn; a separate image turn would create two consecutive user messages.
    user_ollama_msg = {"role": "user", "content": user_message}
    ollama_images = [image_b64] if image_b64 else []
    notes = []

    # Vault photo links the user pasted (copy-link) → feed the real image so she reacts
    ref_ids = re.findall(r"vault://photo/(\d+)", user_message)
    if vision and ref_ids:
        added = 0
        for rid in ref_ids[:4]:
            img = db.query(Image).filter(Image.id == int(rid)).first()
            if img and img.file_path and os.path.exists(img.file_path):
                b = _vault_image_b64(img.file_path)
                if b:
                    ollama_images.append(b); added += 1
        if added:
            user_ollama_msg["content"] = re.sub(r"vault://photo/\d+", "", user_message).strip()
            notes.append("the attached photo(s) are your own content from your collection — react as yourself")

    if notes:
        user_ollama_msg["content"] = (user_ollama_msg["content"] + "\n\n(" + "; ".join(notes) + ".)").strip()
    if ollama_images:
        user_ollama_msg["images"] = ollama_images
    messages.append(user_ollama_msg)

    db.add(CompanionMessage(
        role="user", content=user_message,
        bond_level=bond_level,
        persona_id=config.active_persona_id,
        image_data_url=image_data_url,
    ))
    db.commit()

    llm = OllamaClient(config.ollama_url, config.ollama_model, keep_alive=config.keep_alive or "10m", num_ctx=config.num_ctx or 16384)

    async def event_stream():
        full_response = ""
        err = None
        try:
            async for text in llm.stream(system=system_prompt, messages=messages):
                full_response += text
                yield f"data: {json.dumps({'text': text})}\n\n"
        except Exception as e:
            err = str(e)
        # Cold-start retry: a model that just loaded from disk sometimes returns an
        # empty first response (common right after a session reset). Nothing was
        # streamed yet, so retry once cleanly before giving up.
        if not full_response and err is None:
            try:
                async for text in llm.stream(system=system_prompt, messages=messages):
                    full_response += text
                    yield f"data: {json.dumps({'text': text})}\n\n"
            except Exception as e:
                err = str(e)
        if err and not full_response:
            yield f"data: {json.dumps({'error': err})}\n\n"

        if full_response:
            s = SessionLocal()
            try:
                s.add(CompanionMessage(
                    role="assistant", content=full_response,
                    bond_level=bond_level,
                    persona_id=config.active_persona_id
                ))
                s.commit()
            finally:
                s.close()
        yield "data: [DONE]\n\n"
        # After the reply is delivered (model is warm), cache her appearance for
        # future turns — non-blocking, one-time per avatar. She won't mention it
        # unless asked; it's only reference so she never guesses her own look.
        if config.active_persona_id:
            await _bg_avatar_desc(config.active_persona_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


# ── Suggest (streaming) ───────────────────────────────────────────────────────

@router.post("/suggest")
async def suggest(db: Session = Depends(get_db)):
    config = _get_or_create_config(db)
    if not config.enabled:
        raise HTTPException(403, "Companion is disabled")

    vault_context  = build_vault_context(db)
    _, _, bond_prompt = get_bond_prompt(config.bond_xp)
    persona_prompt = build_persona_prompt(db, config)

    system_prompt = f"""{persona_prompt}
{bond_prompt}
{vault_context}
Your job right now: suggest ONE specific thing for him to watch. Be specific — name the creator
or gallery, include its URL, and say why you picked it. Keep it to 2-3 sentences. Be yourself."""

    messages = [{"role": "user", "content": "What should I watch?"}]
    llm = OllamaClient(config.ollama_url, config.ollama_model, keep_alive=config.keep_alive or "10m", num_ctx=config.num_ctx or 16384)

    async def event_stream():
        try:
            async for text in llm.stream(system=system_prompt, messages=messages, max_tokens=200):
                yield f"data: {json.dumps({'text': text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )
