from dotenv import load_dotenv
load_dotenv()

import asyncio
from open_notebook.domain.credential import Credential
from open_notebook.ai.models import Model, DefaultModels

async def seed():
    # Check if we already have the credential
    credentials = await Credential.get_all()
    ollama_cred = None
    for cred in credentials:
        if cred.provider == "ollama":
            ollama_cred = cred
            break
            
    if not ollama_cred:
        print("Creating Ollama credential...")
        ollama_cred = Credential(
            name="Ollama Local",
            provider="ollama",
            modalities=["language"],
            base_url="http://localhost:11434"
        )
        await ollama_cred.save()
        print(f"Created Ollama credential with ID: {ollama_cred.id}")
    else:
        print(f"Ollama credential already exists: {ollama_cred.id}")
        
    # Check and create models
    models = await Model.get_all()
    qwen_chat = None
    qwen_coder = None
    qwen_3b = None
    for model in models:
        if model.name == "qwen2.5:latest":
            qwen_chat = model
        elif model.name == "qwen2.5-coder:14b":
            qwen_coder = model
        elif model.name == "qwen2.5:3b":
            qwen_3b = model
            
    if not qwen_chat:
        print("Creating qwen2.5:latest model...")
        qwen_chat = Model(
            name="qwen2.5:latest",
            provider="ollama",
            type="language",
            credential=ollama_cred.id
        )
        await qwen_chat.save()
        print(f"Created qwen2.5:latest model with ID: {qwen_chat.id}")
        
    if not qwen_coder:
        print("Creating qwen2.5-coder:14b model...")
        qwen_coder = Model(
            name="qwen2.5-coder:14b",
            provider="ollama",
            type="language",
            credential=ollama_cred.id
        )
        await qwen_coder.save()
        print(f"Created qwen2.5-coder:14b model with ID: {qwen_coder.id}")

    if not qwen_3b:
        print("Creating qwen2.5:3b model...")
        qwen_3b = Model(
            name="qwen2.5:3b",
            provider="ollama",
            type="language",
            credential=ollama_cred.id
        )
        await qwen_3b.save()
        print(f"Created qwen2.5:3b model with ID: {qwen_3b.id}")

    # Set default models
    print("Setting default models...")
    defaults = await DefaultModels.get_instance()
    defaults.default_chat_model = qwen_chat.id
    defaults.default_transformation_model = qwen_coder.id or qwen_chat.id
    defaults.large_context_model = qwen_coder.id or qwen_chat.id
    defaults.default_tools_model = qwen_chat.id
    await defaults.update()
    print("Default models updated successfully!")

if __name__ == "__main__":
    asyncio.run(seed())
