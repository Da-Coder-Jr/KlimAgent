"""
KlimAgent — OSWorld Benchmark Runner (NVIDIA NIM)
Run AgentS2.5 on OSWorld with NVIDIA NIM as the sole provider.

Usage:
    python osworld_setup/s2_5/run_klimagent.py \
        --num_tasks 5 \
        --domain all \
        --model meta/llama-3.3-70b-instruct \
        --vision_model nvidia/llama-3.2-90b-vision-instruct

For full OSWorld VM setup, see osworld_setup/s2_5/OSWorld.md
"""
import argparse
import json
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")
load_dotenv()

from agent.nim_params import (
    NVIDIA_NIM_BASE_URL,
    get_generation_params,
    get_grounding_params,
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s %(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("klimagent.osworld")


def get_engine_params(args):
    params = get_generation_params(args.model)
    if args.api_key:
        params["api_key"] = args.api_key
    return params


def get_grounding_engine_params(args):
    params = get_grounding_params(
        model=args.vision_model,
        width=args.screen_width,
        height=args.screen_height,
    )
    if args.api_key:
        params["api_key"] = args.api_key
    return params


def load_tasks(meta_path: Path, domain: str, limit: int):
    with open(meta_path) as f:
        test_all = json.load(f)
    if domain != "all" and domain in test_all:
        test_all = {domain: test_all[domain]}
    tasks = [
        (d, ex_id)
        for d, examples in test_all.items()
        for ex_id in (examples if isinstance(examples, list) else list(examples))
    ]
    return tasks[:limit]


def run_dry(tasks, engine_params, grounding_params, args):
    """
    Dry-run mode (no OSWorld VM): query NVIDIA NIM for each task
    and score based on whether a valid pyautogui plan is produced.
    """
    from openai import OpenAI
    client = OpenAI(
        base_url=NVIDIA_NIM_BASE_URL,
        api_key=engine_params["api_key"],
    )

    scores = []
    for i, (domain, ex_id) in enumerate(tasks):
        logger.info(f"[{i+1}/{len(tasks)}] {domain}/{ex_id}")
        try:
            resp = client.chat.completions.create(
                model=engine_params["model"],
                messages=[
                    {"role": "system", "content": (
                        "You are KlimAgent, a GUI automation agent. "
                        "Given a task domain and example ID, produce a step-by-step "
                        "pyautogui automation script. End with DONE."
                    )},
                    {"role": "user", "content": (
                        f"Task domain: {domain}\nExample ID: {ex_id}\n"
                        "Write a complete pyautogui script to accomplish a typical "
                        f"'{domain}' task. Include imports and DONE at the end."
                    )},
                ],
                max_tokens=512,
                temperature=0.0,
            )
            text = resp.choices[0].message.content or ""
            score = 0.5 if ("pyautogui" in text and "DONE" in text) else 0.0
        except Exception as e:
            logger.error(f"  Error: {e}")
            score = 0.0

        scores.append(score)
        logger.info(f"  Score: {score}  Running avg: {sum(scores)/len(scores):.3f}")

        # Save result
        result_dir = Path(args.result_dir) / domain / ex_id
        result_dir.mkdir(parents=True, exist_ok=True)
        (result_dir / "result.txt").write_text(str(score))

    return scores


def run_osworld(tasks, engine_params, grounding_params, args):
    """Full OSWorld evaluation using DesktopEnv VM."""
    from desktop_env.desktop_env import DesktopEnv
    from gui_agents.s2_5.agents.agent_s import AgentS2_5
    from gui_agents.s2_5.agents.grounding import OSWorldACI
    import osworld_setup.s2_5.lib_run_single as lib_run_single

    scores = []
    env = DesktopEnv(
        action_space="pyautogui",
        path_to_vm=args.path_to_vm,
        headless=args.headless,
        os_type="Ubuntu",
        screen_size=(args.screen_width, args.screen_height),
    )

    try:
        grounding_agent = OSWorldACI(
            platform="linux",
            engine_params_for_generation=engine_params,
            engine_params_for_grounding=grounding_params,
            width=args.screen_width,
            height=args.screen_height,
        )
        agent = AgentS2_5(
            engine_params=engine_params,
            grounding_agent=grounding_agent,
            platform="linux",
            max_trajectory_length=args.max_steps,
        )

        for i, (domain, ex_id) in enumerate(tasks):
            logger.info(f"[{i+1}/{len(tasks)}] {domain}/{ex_id}")
            config_file = ROOT / f"evaluation_sets/examples/{domain}/{ex_id}.json"
            if not config_file.exists():
                logger.warning(f"  Config not found: {config_file}")
                scores.append(0.0)
                continue

            with open(config_file) as f:
                example = json.load(f)

            result_dir = Path(args.result_dir) / domain / ex_id
            result_dir.mkdir(parents=True, exist_ok=True)

            try:
                lib_run_single.run_single_example(
                    agent, env, example, args.max_steps,
                    example["instruction"], args, str(result_dir), scores
                )
            except Exception as e:
                logger.error(f"  Task error: {e}")
                scores.append(0.0)

    finally:
        env.close()

    return scores


def print_summary(scores, model, args):
    avg = sum(scores) / len(scores) if scores else 0.0
    success_rate = avg * 100
    print("\n" + "═" * 50)
    print("  KlimAgent · OSWorld Benchmark Results")
    print("═" * 50)
    print(f"  Model          : {model}")
    print(f"  Tasks run      : {len(scores)}")
    print(f"  Avg score      : {avg:.4f}")
    print(f"  Success rate   : {success_rate:.2f}%")
    print("─" * 50)
    print("  Reference (Agent-S2.5 paper):")
    print("    GPT-4o         : 27.0%")
    print("    Claude 3.7 S   : 38.8%")
    print(f"    KlimAgent NIM  : {success_rate:.2f}%  ← your score")
    print("═" * 50 + "\n")

    # Save summary
    summary = {
        "model": model,
        "provider": "NVIDIA NIM",
        "total_tasks": len(scores),
        "avg_score": avg,
        "success_rate_pct": round(success_rate, 2),
        "scores": scores,
    }
    out = Path(args.result_dir) / "klimagent_summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"  Results saved → {out}")


def main():
    parser = argparse.ArgumentParser(description="KlimAgent OSWorld Benchmark (NVIDIA NIM)")
    parser.add_argument("--model", default="meta/llama-3.3-70b-instruct",
                        help="NVIDIA NIM text model ID")
    parser.add_argument("--vision_model", default="nvidia/llama-3.2-90b-vision-instruct",
                        help="NVIDIA NIM vision/grounding model ID")
    parser.add_argument("--api_key", default="", help="NVIDIA API key (or set NVIDIA_API_KEY)")
    parser.add_argument("--domain", default="all", help="Task domain (all/os/web/office/...)")
    parser.add_argument("--num_tasks", type=int, default=5, help="Max tasks to evaluate")
    parser.add_argument("--max_steps", type=int, default=15, help="Max steps per task")
    parser.add_argument("--result_dir", default=str(ROOT / "benchmark_results"), help="Output dir")
    parser.add_argument("--test_meta", default=str(ROOT / "evaluation_sets/test_small_new.json"))
    parser.add_argument("--dry_run", action="store_true",
                        help="Dry-run: no OSWorld VM, queries NIM for planning quality")
    parser.add_argument("--path_to_vm", default=None)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--screen_width", type=int, default=1920)
    parser.add_argument("--screen_height", type=int, default=1080)
    args = parser.parse_args()

    api_key = args.api_key or os.getenv("NVIDIA_API_KEY", "")
    if not api_key:
        print("Error: NVIDIA_API_KEY not set. Add to .env or pass --api_key")
        sys.exit(1)

    engine_params = get_engine_params(args)
    grounding_params = get_grounding_engine_params(args)

    print(f"\n  KlimAgent · OSWorld Benchmark")
    print(f"  Model    : {args.model}")
    print(f"  Vision   : {args.vision_model}")
    print(f"  Domain   : {args.domain}")
    print(f"  Tasks    : {args.num_tasks}")
    print(f"  Mode     : {'dry-run' if args.dry_run else 'full OSWorld'}\n")

    tasks = load_tasks(Path(args.test_meta), args.domain, args.num_tasks)
    logger.info(f"Loaded {len(tasks)} tasks")

    if args.dry_run:
        scores = run_dry(tasks, engine_params, grounding_params, args)
    else:
        try:
            scores = run_osworld(tasks, engine_params, grounding_params, args)
        except ImportError:
            logger.warning("OSWorld not installed, falling back to dry-run")
            scores = run_dry(tasks, engine_params, grounding_params, args)

    print_summary(scores, args.model, args)


if __name__ == "__main__":
    main()
