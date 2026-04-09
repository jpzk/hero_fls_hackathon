#!/usr/bin/env python3
"""Deploy and run the gaussian splatting pipeline on RunPod.

Usage:
    # Set your API key
    export RUNPOD_API_KEY=your_key_here

    # Run pipeline on RunPod GPU
    python runpod.py path/to/video.mp4

    # With custom settings
    python runpod.py video.mp4 --gpu "NVIDIA RTX 4090" --iterations 30000

Requirements:
    pip install runpod
"""

import argparse
import os
import sys
import time
import json

try:
    import runpod
except ImportError:
    print("Install runpod: pip install runpod")
    sys.exit(1)


# Docker image - build and push to your registry first:
#   docker build -t your-registry/gsplat:latest .
#   docker push your-registry/gsplat:latest
DEFAULT_IMAGE = "your-registry/gsplat:latest"

TEMPLATE_CONFIG = {
    "name": "gsplat-pipeline",
    "imageName": DEFAULT_IMAGE,
    "dockerArgs": "",
    "containerDiskInGb": 20,
    "volumeInGb": 50,
    "volumeMountPath": "/workspace/data",
    "startJupyter": False,
    "startSsh": True,
    "ports": "22/tcp",
    "env": {},
}

GPU_TYPES = {
    "4090": "NVIDIA GeForce RTX 4090",
    "a100": "NVIDIA A100 80GB PCIe",
    "a6000": "NVIDIA RTX A6000",
    "3090": "NVIDIA GeForce RTX 3090",
    "4080": "NVIDIA GeForce RTX 4080",
}


def create_pod(gpu_type: str, image: str) -> dict:
    """Create a RunPod GPU pod."""
    runpod.api_key = os.environ.get("RUNPOD_API_KEY")
    if not runpod.api_key:
        print("Set RUNPOD_API_KEY environment variable")
        sys.exit(1)

    gpu_name = GPU_TYPES.get(gpu_type.lower(), gpu_type)

    pod = runpod.create_pod(
        name="gsplat-train",
        image_name=image,
        gpu_type_id=gpu_name,
        gpu_count=1,
        volume_in_gb=50,
        container_disk_in_gb=20,
        ports="22/tcp",
        volume_mount_path="/workspace/data",
    )

    print(f"Pod created: {pod['id']}")
    return pod


def wait_for_pod(pod_id: str, timeout: int = 300) -> dict:
    """Wait for pod to be ready."""
    start = time.time()
    while time.time() - start < timeout:
        pod = runpod.get_pod(pod_id)
        status = pod.get("desiredStatus", "")
        runtime = pod.get("runtime", {})

        if runtime and runtime.get("uptimeInSeconds", 0) > 0:
            print(f"Pod ready! SSH: {runtime.get('ports', [{}])[0].get('ip', 'N/A')}")
            return pod

        print(f"  Status: {status}... ({int(time.time() - start)}s)")
        time.sleep(10)

    raise TimeoutError(f"Pod not ready after {timeout}s")


def run_pipeline(pod_id: str, video_path: str, iterations: int) -> None:
    """Upload video and run pipeline on the pod."""
    pod = runpod.get_pod(pod_id)
    runtime = pod.get("runtime", {})

    # Get SSH connection info
    ports = runtime.get("ports", [])
    ssh_port = None
    ssh_host = None
    for p in ports:
        if p.get("privatePort") == 22:
            ssh_host = p.get("ip")
            ssh_port = p.get("publicPort")
            break

    if not ssh_host:
        print("Could not find SSH connection info")
        return

    print(f"\nSSH into your pod and run:")
    print(f"  ssh root@{ssh_host} -p {ssh_port}")
    print(f"")
    print(f"Then upload your video and run:")
    print(f"  # From your local machine:")
    print(f"  scp -P {ssh_port} {video_path} root@{ssh_host}:/workspace/data/input.mp4")
    print(f"")
    print(f"  # On the pod:")
    print(f"  python3 pipeline.py /workspace/data/input.mp4 -o /workspace/data/output --iterations {iterations}")
    print(f"")
    print(f"  # Download results:")
    print(f"  scp -P {ssh_port} root@{ssh_host}:/workspace/data/output/point_cloud.splat .")
    print(f"  scp -P {ssh_port} root@{ssh_host}:/workspace/data/output/point_cloud.ply .")
    print(f"")
    print(f"Then view locally: cd viewer && bun dev")
    print(f"Open http://localhost:3000 and drop in the .splat file")


def main():
    parser = argparse.ArgumentParser(description="Run 3DGS pipeline on RunPod")
    parser.add_argument("video", help="Path to input video")
    parser.add_argument("--gpu", default="4090", help="GPU type (4090, a100, a6000, 3090)")
    parser.add_argument("--image", default=DEFAULT_IMAGE, help="Docker image")
    parser.add_argument("--iterations", type=int, default=30_000, help="Training iterations")
    parser.add_argument("--pod-id", help="Use existing pod instead of creating new one")
    args = parser.parse_args()

    if args.pod_id:
        print(f"Using existing pod: {args.pod_id}")
        run_pipeline(args.pod_id, args.video, args.iterations)
    else:
        pod = create_pod(args.gpu, args.image)
        print("Waiting for pod to start...")
        wait_for_pod(pod["id"])
        run_pipeline(pod["id"], args.video, args.iterations)

    print("\nDon't forget to stop the pod when done!")
    print("  runpod stop <pod-id>")


if __name__ == "__main__":
    main()
