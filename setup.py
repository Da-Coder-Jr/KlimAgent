from setuptools import find_packages, setup

setup(
    name="klimagent",
    version="1.0.0",
    description="KlimAgent — Autonomous AI workspace powered by NVIDIA NIM",
    long_description=open("README.md", encoding="utf-8").read(),
    long_description_content_type="text/markdown",
    author="KlimAgent",
    packages=find_packages(exclude=["node_modules", "renderer", "assets"]),
    install_requires=[
        "openai>=1.0.0",
        "fastapi>=0.110.0",
        "uvicorn>=0.29.0",
        "python-dotenv>=1.0.0",
        "pydantic>=2.0.0",
        "numpy",
        "backoff",
        "pandas",
        "Pillow",
        "pyautogui",
        "pytesseract",
        "tiktoken",
    ],
    extras_require={
        "full": ["paddleocr", "paddlepaddle", "scikit-learn"],
        "osworld": ["desktop-env"],
    },
    entry_points={
        "console_scripts": [
            "klimagent-bench=osworld_setup.s2_5.run_klimagent:main",
            "klimagent-bridge=agent.bridge:main",
        ]
    },
    python_requires=">=3.9,<3.13",
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Topic :: Scientific/Engineering :: Artificial Intelligence",
    ],
    keywords="ai nvidia nim agent gui automation osworld benchmark",
)
